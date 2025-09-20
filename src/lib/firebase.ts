import admin from 'firebase-admin'

// Variáveis de ambiente para as credenciais do Firebase Admin.
// Certifique-se de que essas variáveis estão configuradas em seu ambiente (ex: .env.local).
// A credencial de service account é crucial para o Admin SDK.
const serviceAccount = {
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID as string,
    privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n') as string,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL as string,
}

// Inicializa o Firebase Admin apenas uma vez (singleton).
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
    })
}

// Exporta a instância do Firestore do Admin SDK.
// Isso garante que todas as rotas de API que a importarem usem a mesma instância.
export function getFirebaseFirestore() {
    return admin.firestore()
}

// Opcionalmente, exporta também o Messaging para uso nas APIs.
export function getFirebaseMessaging() {
    return admin.messaging()
}
