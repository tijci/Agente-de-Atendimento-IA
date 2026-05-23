import { Request, Response } from 'express';
import { processAIMessage } from '../agents/graph';
import { logger } from '../utils/logger';
import { neppoWsClient } from '../integrations/neppo-ws-client';
export const neppoWebhookHandler = async (req: Request, res: Response) => {
    const payload = req.body;
    const eventType = payload?.event;
    const contentType = payload?.content?.type;
    console.log("📦 PAYLOAD DO NEPPO:", JSON.stringify(payload, null, 2));

    if (eventType !== 'MESSAGE' || contentType !== 'TEXT') {
        return res.status(200).send('Ignorado');
    }
    const phoneNumber = payload.component?.contactId;
    const text = payload.content?.text;

    res.status(200).json({ status: 'processado' });
    try {
        const responseAI = await processAIMessage(phoneNumber, text);
        logger.info({ phoneNumber, responseAI }, '💬 Resposta pronta para envio');
        const sessionId = Number(payload.component?.sessionId);
        if (sessionId) {
            await neppoWsClient.enqueueSendSequence(phoneNumber, responseAI, sessionId);
        } else {
            logger.warn({ phoneNumber }, '❌ Session ID não encontrado para envio via WebSocket');
        }
    } catch (error) {
        logger.error({
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
        }, '❌ Erro ao processar mensagem');

    }
}
