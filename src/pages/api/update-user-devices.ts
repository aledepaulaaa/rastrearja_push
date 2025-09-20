// /pages/api/update-user-devices.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import admin from 'firebase-admin'
import { getFirebaseFirestore } from '@/lib/firebase'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
       // Configura os cabeçalhos CORS antes de qualquer resposta
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept')

    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST'])
        return res.status(405).json({ error: `Método ${req.method} Não Permitido` })
    }

    const { email, deviceIds } = req.body

    // Validação básica
    if (!email || !Array.isArray(deviceIds)) {
        return res.status(400).json({ error: 'Email e um array de deviceIds são obrigatórios.' })
    }

    // Limpa e valida o email
    const emailLimpo = email.replace(/["']/g, '').trim().toLowerCase()
    if (!emailLimpo) {
        return res.status(400).json({ error: 'Email inválido.' })
    }

    try {
         const firestoreDb = getFirebaseFirestore()
        const userDocRef = firestoreDb.collection('token-usuarios').doc(emailLimpo)

        await userDocRef.set(
            {
                deviceIds: admin.firestore.FieldValue.arrayUnion(...deviceIds)
            },
            { merge: true } // merge: true garante que não sobrescrevemos os fcmTokens
        );

        console.log(`Device IDs [${deviceIds.join(', ')}] associados ao usuário ${emailLimpo}.`)

        return res.status(200).json({ success: true, message: 'Dispositivos vinculados com sucesso.' })

    } catch (error: any) {
        // Se o documento não existir, o update() falhará. Podemos tratar isso se necessário,
        // mas o ideal é que o documento já exista por causa do registro do token.
        console.error(`Erro ao vincular dispositivos para ${emailLimpo}:`, error)
        return res.status(500).json({ error: 'Erro interno ao vincular dispositivos.' })
    }
}