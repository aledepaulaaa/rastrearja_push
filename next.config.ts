import { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Adicionar configuração de headers para CORS
  async headers() {
    return [
      {
        // Aplicar a todos os endpoints da API
        source: "/api/:path*",
        headers: [
          {
            key: "Access-Control-Allow-Credentials",
            value: "true"
          },
          {
            key: "Access-Control-Allow-Origin",
            value: "*"
          }, // Em produção, especifique os domínios permitidos
          {
            key: "Access-Control-Allow-Methods",
            value: "GET, OPTIONS, POST, DELETE",
          },
          {
            key: "Access-Control-Allow-Headers",
            value: "X-Requested-With, Content-Type, Authorization",
          },
        ]
      }
    ];
  }
};

export default nextConfig;
