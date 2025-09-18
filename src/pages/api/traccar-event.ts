// src/pages/api/traccar-event.ts
import type { NextApiRequest, NextApiResponse } from "next"
import admin from "firebase-admin"
import { getFirebaseFirestore, getFirebaseMessaging } from "@/lib/firebaseAdmin"

// (Opcional, mas recomendado) Definir uma interface para o seu token
interface FcmToken {
    fcmToken: string
    userAgent: string
    lastUsed?: admin.firestore.Timestamp
    lastEvent?: string
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    // Configuração de CORS (sem alterações, está correto)
    res.setHeader("Access-Control-Allow-Credentials", "true")
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Access-Control-Allow-Methods", "GET,DELETE,POST,OPTIONS")
    res.setHeader(
        "Access-Control-Allow-Headers",
        "X-Requested-With, Content-Type, Authorization"
    )

    if (req.method === "OPTIONS") {
        res.status(200).end()
        return
    }

    const { event, email: emailFromFrontend } = req.body
    console.log("[traccar-event] Payload recebido:", JSON.stringify(req.body, null, 2))

    if (!event || !event.deviceId || !event.type) {
        return res.status(400).json({ error: "Dados de evento inválidos." })
    }

    try {
        const deviceId = event.deviceId
        const messaging = getFirebaseMessaging()
        const firestoreDb = getFirebaseFirestore()
        let successCount = 0
        let failureCount = 0

        // Busca de usuários (sem alterações, está correto)
        const usersQuery = emailFromFrontend
            ? firestoreDb.collection("token-usuarios").doc(emailFromFrontend).get()
                .then(doc => doc.exists ? [doc] : [])
            : firestoreDb.collection("token-usuarios")
                .where("deviceIds", "array-contains", deviceId)
                .get()
                .then(snapshot => snapshot.docs)

        const userDocs = await usersQuery

        if (!userDocs.length) {
            console.log(`Nenhum usuário encontrado para deviceId: ${deviceId}`)
            return res.status(200).json({ message: "Nenhum usuário para notificar." })
        }

        // Preparação do conteúdo da notificação (sem alterações, está excelente)
        const notificationContent = (() => {
            const base = event.name || `Dispositivo ${event.deviceId}`
            switch (event.type) {
                case "deviceOnline": return { title: "Dispositivo Online", body: `${base} está online`, type: "status" }
                case "deviceOffline": return { title: "Dispositivo Offline", body: `${base} está offline`, type: "status" }
                case "deviceMoving": return { title: "Movimento Detectado", body: `${base} está se movendo`, type: "movement" }
                case "deviceStopped": return { title: "Dispositivo Parado", body: `${base} está parado`, type: "movement" }
                case "ignitionOn": return { title: "Ignição Ligada", body: `${base}: ignição ligada`, type: "ignition" }
                case "ignitionOff": return { title: "Ignição Desligada", body: `${base}: ignição desligada`, type: "ignition" }
                case "geofenceEnter": return { title: "Cerca Virtual", body: `${base} entrou em ${event.attributes?.geofenceName || ""}`, type: "geofence" }
                case "geofenceExit": return { title: "Cerca Virtual", body: `${base} saiu de ${event.attributes?.geofenceName || ""}`, type: "geofence" }
                case "alarm": return { title: "Alarme", body: `${base}: ${event.attributes?.alarm || "Alarme ativado"}`, type: "alarm" }
                default: return { title: "Notificação", body: `${base}: ${event.type}`, type: "other" }
            }
        })()

        // Processamento e envio para cada usuário
        const sendPromises = userDocs.map(async (userDoc) => {
            const currentTokens: FcmToken[] = userDoc.data()?.fcmTokens || []
            if (!currentTokens.length) return

            // Envia para cada token do usuário
            for (const tokenData of currentTokens) {
                try {
                    const clickAction = `/device/${deviceId}`

                    // Payload da mensagem (sem alterações, está bem montado)
                    const message = {
                        token: tokenData.fcmToken,
                        notification: {
                            title: notificationContent.title,
                            body: notificationContent.body,
                        },
                        data: {
                            deviceId: String(deviceId),
                            type: notificationContent.type,
                            click_action: clickAction,
                        },
                        webpush: {
                            headers: { Urgency: "high" },
                            notification: {
                                icon: "/pwa-192x192.png",
                                badge: "/pwa-64x64.png",
                                tag: `rastrearja-${deviceId}`,
                                requireInteraction: true,
                                actions: [{ action: "open_device_action", title: "Ver Dispositivo" }]
                            },
                            fcm_options: { link: clickAction }
                        },
                    }

                    const messageId = await messaging.send(message)
                    console.log(`✅ FCM enviado para ${userDoc.id}, messageId:`, messageId)
                    successCount++

                    // --- INÍCIO DA CORREÇÃO ---
                    // Crie um novo array com os dados do token atualizados
                    const updatedTokens = currentTokens.map(token => {
                        if (token.fcmToken === tokenData.fcmToken) {
                            // Retorna o objeto do token atual com os campos atualizados
                            return {
                                ...token,
                                lastUsed: admin.firestore.FieldValue.serverTimestamp(),
                                lastEvent: event.type
                            }
                        }
                        // Retorna os outros tokens sem modificação
                        return token
                    })

                    // Substitua o array antigo pelo novo no Firestore
                    await userDoc.ref.update({
                        fcmTokens: updatedTokens
                    })
                    // --- FIM DA CORREÇÃO ---

                } catch (err: any) {
                    console.error(`❌ Erro ao enviar para ${userDoc.id} (token: ${tokenData.fcmToken}):`, err.message)
                    failureCount++

                    // Lógica para remover token inválido (sem alterações, está correta)
                    if (err.code === "messaging/registration-token-not-registered") {
                        const validTokens = currentTokens.filter(t => t.fcmToken !== tokenData.fcmToken)
                        await userDoc.ref.update({
                            fcmTokens: validTokens,
                            lastTokenRemoval: admin.firestore.FieldValue.serverTimestamp()
                        })
                        console.log(`Token removido para ${userDoc.id}`)
                    }
                }
            }
        })

        await Promise.all(sendPromises)

        return res.status(200).json({
            success: true,
            sent: successCount,
            failed: failureCount,
            timestamp: new Date().toISOString()
        })

    } catch (err: any) {
        console.error("[traccar-event] Erro crítico:", err)
        return res.status(500).json({
            error: "Erro interno ao processar evento.",
            details: err.message
        })
    }
}