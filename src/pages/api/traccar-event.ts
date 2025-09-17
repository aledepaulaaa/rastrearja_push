import type { NextApiRequest, NextApiResponse } from 'next'
import admin from 'firebase-admin'
import { getFirebaseFirestore, getFirebaseMessaging } from '@/lib/firebaseAdmin';

// Função auxiliar para construir a mensagem FCM
function buildFcmMessage(notification: any, deviceId: string, token: string) {
    const clickAction = `/device/${deviceId}`;
    return {
        token,
        notification: { // Apenas os campos básicos como title e body são permitidos aqui
            title: notification.title,
            body: notification.body,
        },
        data: {
            deviceId: String(deviceId),
            type: notification.type,
            timestamp: new Date().toISOString(),
        },
        webpush: {
            headers: {
                Urgency: 'high'
            },
            fcmOptions: {
                link: clickAction
            },
            notification: {
                icon: '/pwa-192x192.png', // Deixe o campo icon apenas aqui.
                badge: '/pwa-64x64.png',
                tag: `rastrearja-${deviceId}-${Date.now()}`,
                requireInteraction: true,
                actions: [
                    {
                        action: 'open_device',
                        title: 'Ver Dispositivo'
                    }
                ],
            }
        },
    };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,DELETE,POST,OPTIONS');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-Requested-With, Content-Type, Authorization'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const { event, email: emailFromFrontend } = req.body;
    console.log("[traccar-event] Payload recebido:", JSON.stringify(req.body, null, 2));

    if (!event || !event.deviceId || !event.type) {
        return res.status(400).json({ error: 'Dados de evento inválidos.' });
    }

    try {
        const deviceId = event.deviceId;
        const messaging = getFirebaseMessaging()
        const firestoreDb = getFirebaseFirestore()
        let successCount = 0;
        let failureCount = 0;

        // Busca usuários
        const usersQuery = emailFromFrontend
            ? firestoreDb.collection('token-usuarios').doc(emailFromFrontend).get()
                .then(doc => doc.exists ? [doc] : [])
            : firestoreDb.collection('token-usuarios')
                .where('deviceIds', 'array-contains', deviceId)
                .get()
                .then(snapshot => snapshot.docs);

        const userDocs = await usersQuery;

        if (!userDocs.length) {
            console.log(`Nenhum usuário encontrado para deviceId: ${deviceId}`);
            return res.status(200).json({ message: 'Nenhum usuário para notificar.' });
        }

        // Prepara notificação
        const makeNotification = (() => {
            const base = event.name || `Dispositivo ${event.deviceId}`;
            switch (event.type) {
                case 'deviceOnline': return {
                    title: 'Dispositivo Online',
                    body: `${base} está online`,
                    type: 'status'
                };
                case 'deviceOffline': return {
                    title: 'Dispositivo Offline',
                    body: `${base} está offline`,
                    type: 'status'
                };
                case 'deviceMoving': return {
                    title: 'Movimento Detectado',
                    body: `${base} está se movendo`,
                    type: 'movement'
                };
                case 'deviceStopped': return {
                    title: 'Dispositivo Parado',
                    body: `${base} está parado`,
                    type: 'movement'
                };
                case 'ignitionOn': return {
                    title: 'Ignição Ligada',
                    body: `${base}: ignição ligada`,
                    type: 'ignition'
                };
                case 'ignitionOff': return {
                    title: 'Ignição Desligada',
                    body: `${base}: ignição desligada`,
                    type: 'ignition'
                };
                case 'geofenceEnter': return {
                    title: 'Cerca Virtual',
                    body: `${base} entrou em ${event.attributes?.geofenceName || ''}`,
                    type: 'geofence'
                };
                case 'geofenceExit': return {
                    title: 'Cerca Virtual',
                    body: `${base} saiu de ${event.attributes?.geofenceName || ''}`,
                    type: 'geofence'
                };
                case 'alarm': return {
                    title: 'Alarme',
                    body: `${base}: ${event.attributes?.alarm || 'Alarme ativado'}`,
                    type: 'alarm'
                };
                default: return {
                    title: 'Notificação',
                    body: `${base}: ${event.type}`,
                    type: 'other'
                };
            }
        })();

        // Processa cada usuário
        const sendPromises = userDocs.map(async (userDoc) => {
            const tokens = userDoc.data()?.fcmTokens || [];
            if (!tokens.length) return;

            // Envia para cada token do usuário
            for (const tokenData of tokens) {
                try {
                    const message: any = buildFcmMessage(
                        makeNotification,
                        String(deviceId),
                        tokenData.fcmToken
                    );

                    const messageId = await messaging.send(message);
                    console.log(`✅ FCM enviado para ${userDoc.id}, messageId:`, messageId);
                    successCount++;

                    // Atualiza último uso do token
                    await userDoc.ref.update({
                        [`fcmTokens.${tokens.indexOf(tokenData)}.lastUsed`]: admin.firestore.FieldValue.serverTimestamp(),
                        [`fcmTokens.${tokens.indexOf(tokenData)}.lastEvent`]: event.type
                    });

                } catch (err: any) {
                    console.error(`❌ Erro ao enviar para ${userDoc.id}:`, err.message);
                    failureCount++;

                    if (err.code === 'messaging/registration-token-not-registered') {
                        // Remove token inválido
                        const validTokens = tokens.filter((t: any) => t.fcmToken !== tokenData.fcmToken);
                        await userDoc.ref.update({
                            fcmTokens: validTokens,
                            lastTokenRemoval: admin.firestore.FieldValue.serverTimestamp()
                        });
                        console.log(`Token removido para ${userDoc.id}`);
                    }
                }
            }
        });

        await Promise.all(sendPromises);

        return res.status(200).json({
            success: true,
            sent: successCount,
            failed: failureCount,
            timestamp: new Date().toISOString()
        });

    } catch (err: any) {
        console.error('[traccar-event] Erro:', err);
        return res.status(500).json({
            error: 'Erro interno ao processar evento.',
            details: err.message
        });
    }
}