import { clearTimeout } from 'node:timers';
import { logger } from './logger';
interface PendingBatch {
    messages: string[];
    timer: NodeJS.Timeout;
    forceTimer: NodeJS.Timeout;
    sessionId: number;
}


const DEBOUNCE_DELAY = 15000;
const MAX_MESSAGES = 20;
const FORCE_TIMEOUT = 30000;
const MAX_CHARS = 2000;

type ProcessCallback = (phoneNumber: string, fullMessage: string, sessionId: number) => Promise<void>;

export class MessageDebouncer {
    private pending = new Map<string, PendingBatch>();
    constructor(private onProcess: ProcessCallback) { }

    add(phoneNumber: string, text: string, sessionId: number) {
        const existing = this.pending.get(phoneNumber);
        if (existing) {
            clearTimeout(existing.timer);
            existing.messages.push(text);
            existing.sessionId = sessionId;

            const totalChars = existing.messages.join('\n').length;
            if (existing.messages.length >= MAX_MESSAGES || totalChars >= MAX_CHARS) {
                logger.info({ phoneNumber, count: existing.messages.length }, '⚡ Limite atingido, processando imediatamente');
                this.flush(phoneNumber);
                return;
            }

            existing.timer = setTimeout(() => this.flush(phoneNumber), DEBOUNCE_DELAY);
            logger.info({ phoneNumber, count: existing.messages.length }, '📝 Mensagem acumulada no buffer');
        } else {
            const timer = setTimeout(() => this.flush(phoneNumber), DEBOUNCE_DELAY);

            const forceTimer = setTimeout(() => {
                if (this.pending.has(phoneNumber)) {
                    logger.info({ phoneNumber }, '⏰ Force timeout! Processando batch acumulado')
                    this.flush(phoneNumber);
                }
            }, FORCE_TIMEOUT)

            this.pending.set(phoneNumber, {
                messages: [text],
                timer,
                forceTimer,
                sessionId
            });
            logger.info({ phoneNumber }, '🕐 Nova batch iniciada (aguardando mais mensagens...)');
        }
    }

    private async flush(phoneNumber: string) {
        const batch = this.pending.get(phoneNumber);
        if (!batch) return;

        clearTimeout(batch.timer);
        clearTimeout(batch.forceTimer);
        this.pending.delete(phoneNumber);
        const fullMessage = batch.messages.join('\n');
        logger.info(
            { phoneNumber, messageCount: batch.messages.length, fullMessage },
            '🔄 Processando batch completa'
        );
        try {
            await this.onProcess(phoneNumber, fullMessage, batch.sessionId);
        } catch (err) {
            logger.error({ err, phoneNumber }, '❌ Erro ao processar batch');
        }
    }
}