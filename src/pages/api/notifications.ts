//backend-firebase-nextjs/src/pages/api/notifications.ts
import { getFirebaseFirestore } from '@/lib/firebaseAdmin'
import type { NextApiRequest, NextApiResponse } from 'next'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
  const { fcmToken, email, deviceId = 'default' } = req.body;

  if (!fcmToken || !email) {
    return res.status(400).json({ error: 'Token e email são obrigatórios' });
  }

  const cleanEmail = email.replace(/["']/g, '').trim().toLowerCase();
  const firestoreDb = getFirebaseFirestore();
  const userRef = firestoreDb.collection('token-usuarios').doc(cleanEmail);

  try {
    const doc = await userRef.get();
    const now = new Date().toISOString();
    
    if (doc.exists) {
      const tokens = doc.data()?.fcmTokens || [];
      const tokenIndex = tokens.findIndex((t: any) => t.deviceId === deviceId);
      
      if (tokenIndex >= 0) {
        tokens[tokenIndex] = { ...tokens[tokenIndex], fcmToken, updatedAt: now };
      } else {
        tokens.push({ deviceId, fcmToken, createdAt: now, updatedAt: now });
      }
      
      await userRef.update({ fcmTokens: tokens });
    } else {
      await userRef.set({
        fcmTokens: [{
          deviceId,
          fcmToken,
          createdAt: now,
          updatedAt: now
        }]
      });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Erro ao registrar token:', error);
    return res.status(500).json({ error: 'Erro interno ao registrar token' });
  }
}

async function deleteToken(req: NextApiRequest, res: NextApiResponse) {
    const { email, deviceId, fcmToken } = req.body
    if (!email) return res.status(400).json({ error: 'Email é obrigatório' })
    const firestoreDb = getFirebaseFirestore()
    const ref = firestoreDb.collection('token-usuarios').doc(email)
    const doc = await ref.get()
    if (!doc.exists) return res.status(200).json({ success: true })

    let tokens = doc.data()?.fcmTokens || []
    if (deviceId) tokens = tokens.filter((t: any) => t.deviceId !== deviceId)
    else if (fcmToken) tokens = tokens.filter((t: any) => t.fcmToken !== fcmToken)
    else return res.status(400).json({ error: 'Token ou deviceId necessário' })

    await ref.update({ fcmTokens: tokens })
    return res.status(200).json({ success: true })
}
