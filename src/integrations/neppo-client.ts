import { env } from "../config/env";
import { logger } from "../utils/logger";

interface NeppoDirectMessage {
    phoneNumber: string;
    channel: string;
    message: string;
    groupName: string;
    status: string;
    createdBy: string;
    userId: number;
    groupConfId: number;
}

class NeppoClient {
    private baseUrl = env.NEPPO_API_URL;
    private authUrl = 'https://api-auth.neppo.com.br/oauth2/token';
    private async getToken(): Promise<string | null> {
        const credenciais = Buffer.from(`${env.NEPPO_CUSTOMER_KEY}:${env.NEPPO_CUSTOMER_SECRET}`).toString('base64');
        const body = new URLSearchParams({
            grant_type: 'password',
            username: env.NEPPO_USERNAME,
            password: env.NEPPO_PASSWORD
        });

        try {
            const response = await fetch(this.authUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${credenciais}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body
            })
            if (response.ok) {
                const data = await response.json();
                logger.info(data);
                return data.access_token;
            }
            return null;
        } catch (err) {
            logger.error({ erro: err }, '❌ Erro ao conectar na recepção do Neppo');
            return null;
        }

    }


    async sendMessage(phoneNumber: string, message: string): Promise<boolean> {

        const token = await this.getToken();
        if (!token) {
            logger.error({}, '❌ Não foi possível obter token do Neppo');
            return false;
        }

        const payload: NeppoDirectMessage = {
            phoneNumber,
            channel: 'WHATSAPP',
            message,
            groupName: env.NEPPO_GROUP_NAME,
            status: 'PROCESSANDO',
            createdBy: 'AI',
            userId: env.NEPPO_USER_ID,
            groupConfId: env.NEPPO_GROUP_CONF_ID,
        };

        try {
            const response = await fetch(
                `${this.baseUrl}/chatapi/1.0/api/direct-message/save`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                    },
                    body: JSON.stringify(payload),
                }
            )
            if (!response.ok) {
                const errorBody = await response.text();
                logger.error({
                    status: response.status,
                    body: errorBody,
                }, '❌ Neppo rejeitou o envio');
                return false;
            }
            logger.info(await response.text());
            logger.info({ phoneNumber }, '📤 Mensagem enviada via Neppo');
            return true;

        } catch (err) {
            const error = err as any;
            logger.error({
                mensagem: error?.message,
                motivoReal: error?.cause?.message || 'Motivo desconhecido',
                urlTentada: `${this.baseUrl}/chatapi/1.0/api/direct-message/save`
            }, '❌ Erro de conexão com Neppo');

            return false;
        }
    }
}

export const neppoClient = new NeppoClient();