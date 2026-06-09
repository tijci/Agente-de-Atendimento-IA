/**
 * Cliente HTTP para o CRM KSI.
 * Envia lead pré-qualificado via webhook com Bearer token.
 * @module integrations/ksi-crm-client
 */

import { env } from '../config/env';
import { logger } from '../utils/logger';

export interface KSILeadPayload {
    ksi_nome: string;
    ksi_email?: string;
    ksi_celular: string;
    ksi_operacao: 'V' | 'L';
    ksi_id_imovel: number[];
    ksi_observacoes: string;
}

export interface KSILeadResult {
    success: boolean;
    status?: number;
    body?: unknown;
    error?: string;
}

class KSICrmClient {
    async sendLead(payload: KSILeadPayload): Promise<KSILeadResult> {
        const url = `${env.KSI_API_URL}`;
        logger.info({ payload, url }, '📤 [KSI] Enviando lead para o CRM...');

        try {
            const response = await fetch(url, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${env.KSI_API_TOKEN}`
                },
                body: JSON.stringify(payload),
            });

            const body = await response.json().catch(() => response.text());

            if (!response.ok) {
                logger.error(
                    { status: response.status, body, payload },
                    '❌ [KSI] CRM rejeitou o lead'
                );
                return { success: false, status: response.status, body };

            } logger.info({ status: response.status, body }, '✅ [KSI] Lead registrado com sucesso!');
            return { success: true, status: response.status, body };
        } catch (err: any) {
            logger.error({ err: err?.message, url }, '❌ [KSI] Erro de conexão com o CRM');
            return { success: false, error: err?.message ?? 'Erro desconhecido' };
        }
    }
}

export const ksiCrmClient = new KSICrmClient();
