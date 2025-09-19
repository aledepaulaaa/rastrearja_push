//src/pages/api/traccar-events.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import admin from 'firebase-admin'
import { getFirebaseFirestore } from '@/lib/firebaseAdmin'

// Interface para o payload do evento que o Traccar envia. Nenhuma alteração aqui.
interface EventNotificationPayload {
    id: number
    attributes?: Record<string, any>
    deviceId: number
    name: string // Este campo é populado pelo Traccar com o nome do dispositivo
    type: string
    eventTime: string
    positionId?: number
    geofenceId?: number
    maintenanceId?: number
}

// Interface para o corpo da requisição que o Traccar envia.
// Ele envia um objeto que contém a chave "event".
interface TraccarForwardRequest {
    event: EventNotificationPayload
    // O Traccar também pode enviar um objeto "position", mas não o usaremos aqui.
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {

    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST'])
        return res.status(405).json({ error: `Método ${req.method} Não Permitido` })
    }

    const { event, email: emailFromFrontend } = req.body;
    console.log("api/traccar-event - Corpo do request recebido:", req.body)

    // Validação para garantir que o objeto 'event' e seus campos essenciais existem.
    if (!event || !event.deviceId || !event.type) {
        return res.status(400).json({ error: 'Dados de evento inválidos ou malformados.' })
    }

    if (!event || !event.deviceId || !event.type) {
        return res.status(400).json({ error: 'Dados de evento inválidos ou malformados.' })
    }

    try {
        const deviceId = event.deviceId
        let userDocs: any = [];

        // --- LÓGICA DE BUSCA CORRIGIDA ---
        if (emailFromFrontend) {
            console.log(`Buscando usuário pelo email fornecido pelo frontend: ${emailFromFrontend}`)
            const firestoreDb = getFirebaseFirestore()
            const userDoc = await firestoreDb.collection('token-usuarios').doc(emailFromFrontend).get()
            if (userDoc.exists) {
                userDocs.push(userDoc);
            }
        } else {
            console.log(`Buscando usuário pelo deviceId: ${deviceId}`)
            const firestoreDb = getFirebaseFirestore()
            const usersSnapshot = await firestoreDb.collection('token-usuarios')
                .where('deviceIds', 'array-contains', deviceId)
                .get()

            if (!usersSnapshot.empty) {
                userDocs = usersSnapshot.docs;
            }
        }

        if (userDocs.length === 0) {
            console.log(`Nenhum usuário encontrado para o deviceId: ${deviceId}. Evento ignorado.`)
            return res.status(200).json({ message: `Nenhum usuário associado ao deviceId ${deviceId}.` })
        }

        console.log(`Encontrado(s) ${userDocs.length} usuário(s) para notificar sobre o deviceId ${deviceId}`);

        let totalSent = 0
        let totalFailed = 0
        let totalInvalidRemoved = 0

        // Processa a notificação para cada usuário encontrado
        for (const userDoc of userDocs) {
            const userEmail = userDoc.id
            const userData = userDoc.data()

            // Verifica se fcmTokens existe e é um array
            if (!userData?.fcmTokens || !Array.isArray(userData.fcmTokens)) {
                console.log(`Dados de token inválidos para usuário ${userEmail}`)
                continue
            }

            // Extrai apenas os tokens válidos
            const tokens = userData.fcmTokens
                .filter((token: any) => token && typeof token === 'object' && token.fcmToken)
                .map((token: any) => token.fcmToken);

            if (tokens.length === 0) {
                console.log(`Nenhum token FCM válido encontrado para o usuário ${userEmail}. Pulando.`)
                continue
            }

            console.log(`Enviando notificação para ${userEmail} (${tokens.length} tokens) para o evento do deviceId ${deviceId}`)

            // 4. Cria o conteúdo da notificação (sua lógica original, sem alterações).
            const makeNotification = (() => {
                const base = event.name || `Dispositivo ${event.deviceId}`
                switch (event.type) {
                    case 'deviceOnline': return { title: 'Dispositivo Online', body: `${base} está online` }
                    case 'deviceOffline': return { title: 'Dispositivo Offline', body: `${base} está offline` }
                    case 'deviceMoving': return { title: 'Movimento Detectado', body: `${base} está se movendo` }
                    case 'deviceStopped': return { title: 'Dispositivo Parado', body: `${base} está parado` }
                    case 'ignitionOn': return { title: 'Ignição Ligada', body: `${base}: ignição ligada` }
                    case 'ignitionOff': return { title: 'Ignição Desligada', body: `${base}: ignição desligada` }
                    case 'geofenceEnter': return { title: 'Cerca Virtual', body: `${base} entrou em ${event.attributes?.geofenceName || ''}` }
                    case 'geofenceExit': return { title: 'Cerca Virtual', body: `${base} saiu de ${event.attributes?.geofenceName || ''}` }
                    case 'alarm': return { title: 'Alarme', body: `${base}: ${event.attributes?.alarm || 'Alarme ativado'}` }
                    default: return { title: 'Notificação', body: `${base}: ${event.type}` }
                }
            })()

            // 5. Monta e envia a mensagem FCM (sua lógica original, sem alterações).
            const message: admin.messaging.MulticastMessage = {
                tokens,
                notification: makeNotification,
                data: {
                    name: String(event.name),
                    type: event.type,
                    eventTime: event.eventTime,
                    deviceId: String(event.deviceId) // Adicionado para referência no cliente
                },
                android: {
                    priority: 'high',
                    notification: {
                        channelId: 'high_importance_channel'
                    }
                },
                apns: {
                    payload: {
                        aps: {
                            sound: 'default',
                            badge: 1
                        }
                    }, headers: { 'apns-priority': '10' }
                },
                webpush: {
                    fcmOptions: {
                        link: `/device/${event.deviceId}`
                    },
                    notification: {
                        icon: '/icon-192x192.png',
                        badge: '/icon-64x64.png',
                    }
                }
            }

            const response = await admin.messaging().sendEachForMulticast(message)
            totalSent += response.successCount
            totalFailed += response.failureCount

            // 6. Lógica de limpeza de tokens inválidos, agora adaptada para o loop.
            const invalidTokens: string[] = []
            response.responses.forEach((r, i) => {
                if (!r.success && ['messaging/invalid-registration-token', 'messaging/registration-token-not-registered'].includes(r.error?.code || '')) {
                    invalidTokens.push(tokens[i])
                }
            })

            if (invalidTokens.length > 0) {
                console.log(`Encontrados ${invalidTokens.length} tokens inválidos para ${userEmail}:`, invalidTokens)
                const validTokens = tokens.filter((t: any) => !invalidTokens.includes(t.fcmToken))
                await userDoc.ref.update({ fcmTokens: validTokens })
                totalInvalidRemoved += invalidTokens.length
                console.log(`Tokens inválidos de ${userEmail} removidos do Firestore.`)
            }
        }

        return res.status(200).json({
            success: true,
            message: 'Processamento de evento concluído.',
            sent: totalSent,
            failed: totalFailed,
            invalidRemoved: totalInvalidRemoved,
        })

    } catch (err: any) {
        console.error('[traccar-event] erro', err)
        return res.status(500).json({ error: 'Erro interno ao processar evento.' })
    }
}