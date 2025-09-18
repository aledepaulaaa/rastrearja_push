//backend-firebase-nextjs/src/pages/api/notifications.ts
import { getFirebaseFirestore } from '@/lib/firebaseAdmin';
import type { NextApiRequest, NextApiResponse } from 'next'
import admin from 'firebase-admin'

interface FcmToken {
    fcmToken: string;
    deviceId: string; // ID único do dispositivo/navegador
    userAgent: string; // Ajuda a identificar o dispositivo
    createdAt: admin.firestore.FieldValue;
    updatedAt: admin.firestore.FieldValue;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*'); // Ou 'https://app.rastrearja.com'
    res.setHeader('Access-Control-Allow-Methods', 'GET,DELETE,POST,OPTIONS');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-Requested-With, Content-Type, Authorization'
    );


    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return
    }

    switch (req.method) {
        case 'GET': return checkUserToken(req, res)
        case 'POST': return registerToken(req, res)
        case 'DELETE': return deleteToken(req, res)
        default:
            res.setHeader('Allow', ['GET', 'POST', 'DELETE'])
            return res.status(405).end(`Metódo ${req.method} Não Permitido`)
    }
}

async function checkUserToken(req: NextApiRequest, res: NextApiResponse) {
    const { email, deviceId } = req.query
    console.log("Email: /api/notifications", email)
    console.log("DeviceID /api/notifications: ", deviceId)

    if (!email) return res.status(400).json({ error: 'Email é obrigatório' })
    const firestoreDb = getFirebaseFirestore()
    const ref = firestoreDb.collection('token-usuarios').doc(email as string)
    const doc = await ref.get()
    if (!doc.exists) return res.status(200).json({ hasValidToken: false })
    const tokens = doc.data()?.fcmTokens || []
    if (deviceId) {
        const dev = tokens.find((t: any) => t.deviceId === deviceId)
        return res.status(200).json({ hasValidToken: !!dev, token: dev?.fcmToken })
    }
    return res.status(200).json({ hasValidToken: tokens.length > 0, token: tokens[0]?.fcmToken })
}

async function registerToken(req: NextApiRequest, res: NextApiResponse) {
    const { fcmToken, email, deviceId, userAgent } = req.body;

    // Validação mais simples e robusta
    if (!fcmToken || !email || !deviceId) {
        return res.status(400).json({ error: 'fcmToken, email e deviceId são obrigatórios.' });
    }

    const emailLimpo = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLimpo)) {
        return res.status(400).json({ error: 'Formato de email inválido.' });
    }

    const firestoreDb = getFirebaseFirestore();
    const ref = firestoreDb.collection('token-usuarios').doc(emailLimpo);

    try {
        const doc = await ref.get();
        let currentTokens: FcmToken[] = doc.exists ? doc.data()?.fcmTokens || [] : [];

        // Verifica se o token exato já existe
        const tokenExists = currentTokens.some(t => t.fcmToken === fcmToken);
        if (tokenExists) {
            console.log(`Token ${fcmToken} já existe para ${emailLimpo}. Nenhuma ação necessária.`);
            return res.status(200).json({ success: true, message: 'Token já registrado.' });
        }

        // Se não existe, remove qualquer token antigo para o mesmo deviceId e adiciona o novo.
        // Isso previne tokens duplicados para o mesmo navegador/dispositivo.
        const otherTokens = currentTokens.filter(t => t.deviceId !== deviceId);

        const newToken: Omit<FcmToken, 'createdAt'> & { createdAt?: any, updatedAt: any } = {
            fcmToken,
            deviceId,
            userAgent: userAgent || 'N/A', // Capturar o user-agent do frontend
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        const finalTokens = [...otherTokens, newToken];

        if (doc.exists) {
            await ref.update({ fcmTokens: finalTokens });
        } else {
            // Se o documento não existe, adicionamos o campo createdAt ao criar o token
            newToken.createdAt = admin.firestore.FieldValue.serverTimestamp();
            await ref.set({ fcmTokens: [newToken], email: emailLimpo }); // Salva o email no doc
        }

        console.log(`Token para deviceId ${deviceId} registrado/atualizado para ${emailLimpo}.`);
        return res.status(200).json({ success: true });

    } catch (error: any) {
        console.error(`Erro ao registrar token para ${emailLimpo}:`, error);
        return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
}

async function deleteToken(req: NextApiRequest, res: NextApiResponse) {
    const { email, fcmToken } = req.body

    console.log({
        "Pedido de remoção token": email,
        "Token": fcmToken
    })

    if (!email || !fcmToken) {
        return res.status(400).json({ error: 'Email e fcmToken são obrigatórios para a remoção.' })
    }

    const firestoreDb = getFirebaseFirestore()
    const emailLimpo = String(email).trim().toLowerCase();
    const ref = firestoreDb.collection('token-usuarios').doc(emailLimpo);
    const doc = await ref.get()

    if (!doc.exists) {
        // Se o documento não existe, o token já não está lá. Sucesso.
        return res.status(200).json({ success: true })
    }

    let tokens = doc.data()?.fcmTokens || []

    // Filtra o array para remover o objeto que contém o fcmToken
    const newTokens = tokens.filter((t: any) => t.fcmToken !== fcmToken)

    // Se o array mudou de tamanho, significa que um token foi removido.
    if (newTokens.length !== tokens.length) {
        await ref.update({ fcmTokens: newTokens })
        console.log(`Token do dispositivo para ${email} removido com sucesso.`)
        return res.status(200).json({ success: true })
    } else {
        // O token não foi encontrado, mas o cliente solicitou a remoção.
        // Trate como sucesso para evitar loops de erro.
        console.log(`Token ${fcmToken} não encontrado no banco de dados.`)
        return res.status(200).json({ success: true })
    }
}
