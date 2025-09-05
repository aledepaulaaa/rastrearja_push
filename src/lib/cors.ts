// backend-firebase-nextjs/src/lib/cors.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import Cors from 'cors';

// Lista de origens permitidas. Adicione 'http://localhost:3000' para testes locais.
const allowedOrigins = ['https://app.rastrearja.com'];

const corsOptions: Cors.CorsOptions = {
    methods: ['GET', 'POST', 'DELETE', 'HEAD', 'OPTIONS'],
    origin: (origin, callback) => {
        // Permite requisições sem 'origin' (ex: Postman, apps móveis) ou da lista de permitidos.
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Não permitido pela política de CORS'));
        }
    },
    credentials: true,
};

// Inicializa o middleware do CORS com as opções
const cors = Cors(corsOptions);

// Helper para rodar o middleware antes do seu handler da API
export function runCorsMiddleware(req: NextApiRequest, res: NextApiResponse) {
    return new Promise((resolve, reject) => {
        cors(req, res, (result: any) => {
            if (result instanceof Error) {
                return reject(result);
            }
            return resolve(result);
        });
    });
}