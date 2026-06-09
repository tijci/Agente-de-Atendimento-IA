/**
 * Tool LangGraph: registra lead pré-qualificado no CRM KSI.
 * O SDR chama esta tool quando tiver nome e pelo menos um imóvel de interesse.
 * E-mail é opcional — não invente endereços fictícios.
 * @module agents/tools/register-lead-tool
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { ksiCrmClient } from '../../integrations/ksi-crm-client';
import { logger } from '../../utils/logger';

const registerLeadSchema = z.object({
    nome: z.string().describe('Nome do cliente (primeiro nome ou nome completo)'),
    email: z.string().optional().describe('E-mail do cliente — omita se o cliente não informou'),
    celular: z.string().describe('Número de telefone do cliente (somente dígitos)'),
    operacao: z.enum(['V', 'L']).describe('V = Compra/Venda  |  L = Locação/Aluguel'),
    ids_imoveis: z
        .array(z.number())
        .describe('IDs numéricos dos imóveis de interesse (sem letras L/V). Caso não tenha imovel definido, use 1'),
    observacoes: z
        .string()
        .describe('Resumo: tipo de imóvel, bairro, faixa de preço, preferências'),
});

export const registerLeadTool = tool(
    async ({ nome, email, celular, operacao, ids_imoveis, observacoes }) => {
        const celularLimpo = celular.replace(/\D/g, '');
        const celularFinal =
            celularLimpo.startsWith('55') && celularLimpo.length > 11
                ? celularLimpo.slice(2)
                : celularLimpo;

        const result = await ksiCrmClient.sendLead({
            ksi_nome: nome,
            ...(email ? { ksi_email: email } : {}),
            ksi_celular: celularFinal,
            ksi_operacao: operacao,
            ksi_id_imovel: ids_imoveis,
            ksi_observacoes: observacoes,
        });
        if (result.success) {
            logger.info({ nome, celularFinal, ids_imoveis }, '🎯 Lead registrado no KSI');
            return 'LEAD_REGISTRADO';
        }
        logger.warn({ result }, '⚠️ Falha ao registrar lead no KSI');
        return 'LEAD_FALHOU';
    },
    {
        name: 'registrar_lead',
        description:
            'Registra o lead no CRM KSI. ' +
            'Chame SOMENTE quando tiver nome + pelo menos 1 imóvel de interesse. ' +
            'E-mail é opcional — não invente nem force coleta. ' +
            'Não chame mais de uma vez por conversa.',
        schema: registerLeadSchema,
    }
)