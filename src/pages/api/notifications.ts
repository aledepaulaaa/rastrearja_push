//backend-firebase-nextjs/src/pages/api/notifications.ts
import { getFirebaseFirestore } from "@/lib/firebase"
import type { NextApiRequest, NextApiResponse } from "next"

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Configura os cabeçalhos CORS antes de qualquer resposta
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept")

  // Tratamento da requisição OPTIONS
  if (req.method === "OPTIONS") {
    // Encerra a requisição de pré-voo com sucesso
    return res.status(200).end()
  }

  switch (req.method) {
    case "GET": return checkUserToken(req, res)
    case "POST": return handlePostRequest(req, res) // Nova função para lidar com POST
    case "DELETE": return deleteToken(req, res)
    default:
      res.setHeader("Allow", ["GET", "POST", "DELETE"])
      return res.status(405).end(`Metódo ${req.method} Não Permitido`)
  }
}

async function handlePostRequest(req: NextApiRequest, res: NextApiResponse) {
  const { action } = req.body

  // Se a ação for "unregister", chama a função de exclusão
  if (action === "unregister") {
    return deleteToken(req, res)
  }

  // Caso contrário, continua com o registro
  return registerToken(req, res)
}

async function checkUserToken(req: NextApiRequest, res: NextApiResponse) {
  const { email, deviceId } = req.query

  if (!email) return res.status(400).json({ error: "Email é obrigatório" })

  const firestoreDb = getFirebaseFirestore()
  const ref = firestoreDb.collection("token-usuarios").doc(email as string)
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
  const { fcmToken, email, deviceId = "default" } = req.body

  if (!fcmToken || !email) {
    return res.status(400).json({ error: "Token e email são obrigatórios" })
  }

  const cleanEmail = email.replace(/[""]/g, "").trim().toLowerCase()
  const firestoreDb = getFirebaseFirestore()
  const userRef = firestoreDb.collection("token-usuarios").doc(cleanEmail)

  try {
    const doc = await userRef.get()
    const now = new Date().toISOString()

    let tokens = doc.exists ? doc.data()?.fcmTokens || [] : []

    // Remove qualquer token antigo com o mesmo deviceId para evitar duplicatas
    tokens = tokens.filter((t: any) => t.deviceId !== deviceId)

    // Adiciona o novo token
    tokens.push({ deviceId, fcmToken, createdAt: now, updatedAt: now })

    if (doc.exists) {
      await userRef.update({ fcmTokens: tokens })
    } else {
      await userRef.set({ fcmTokens: tokens })
    }

    return res.status(200).json({ success: true })
  } catch (error) {
    console.error("Erro ao registrar token:", error)
    return res.status(500).json({ error: "Erro interno ao registrar token" })
  }
}

async function deleteToken(req: NextApiRequest, res: NextApiResponse) {
  const { email, fcmToken } = req.body // MUDANÇA: Vamos usar fcmToken para a remoção
  if (!email || !fcmToken) {
    return res.status(400).json({ error: "Email e fcmToken são obrigatórios para desregistro" })
  }

  const firestoreDb = getFirebaseFirestore()
  const ref = firestoreDb.collection("token-usuarios").doc(email)
  const doc = await ref.get()
  if (!doc.exists) return res.status(200).json({ success: true })

  let tokens = doc.data()?.fcmTokens || []

  // Filtra para remover o token específico
  const newTokens = tokens.filter((t: any) => t.fcmToken !== fcmToken)

  await ref.update({ fcmTokens: newTokens })
  return res.status(200).json({ success: true })
}