/**
 * Cliente WebSocket STOMP Neppo — canal principal de entrada/saída WhatsApp.
 * @module integrations/neppo-ws-client
 * @see docs/MODULES.md#srcintegrationsneppo-ws-clientts
 */
import { Client } from "@stomp/stompjs";
import WebSocket from "ws";
import { processAIMessage } from '../agents/graph';
import { MessageDebouncer } from '../utils/message-debouncer';
import { translator } from '../utils/message-translator';
import { env } from '../config/env';
import { parseMarkedResponse, prepareOutboundMessages } from '../utils/message-splitter';
import { randomInterMessageDelayMs, sleep } from '../utils/humanize';
import { logger } from '../utils/logger';
import { sanitizeOutboundText } from '../utils/outbound-sanitize';

export class NeppoWsClient {
    private cookieSession: string = '';
    private stompClient: Client | null = null;
    private botResource = Math.random().toString(36).substring(2, 10);
    private outboundQueue = new Map<string, Promise<void>>();

    private debouncer = new MessageDebouncer(async (phoneNumber, fullMessage, sessionId) => {
        await this.enqueueOutbound(phoneNumber, async () => {
            try {
                const AIResponse = await processAIMessage(phoneNumber, fullMessage);
                await this.sendMessageSequence(AIResponse, sessionId, phoneNumber);
            } catch (error) {
                logger.error({ err: error, phoneNumber }, '❌ Erro no LangGraph');
            }
        });
    });

    private enqueueOutbound(phoneNumber: string, task: () => Promise<void>): Promise<void> {
        const previous = this.outboundQueue.get(phoneNumber) ?? Promise.resolve();
        const next = previous
            .catch(() => undefined)
            .then(task);

        this.outboundQueue.set(phoneNumber, next);

        return next.finally(() => {
            if (this.outboundQueue.get(phoneNumber) === next) {
                this.outboundQueue.delete(phoneNumber);
            }
        });
    }

    async login() {
        console.log('🔄 Tentando fazer login como Agente Fantasma...');
        const passwordBase64 = Buffer.from('TesteTI123#').toString('base64');
        const body = new URLSearchParams({
            username: 'teste.ti',
            password: passwordBase64,
            verificationToken: 'null'
        });

        try {
            const response = await fetch('https://juliocasas.neppo.com.br/chat/login', {
                method: 'POST',
                body: body,
                redirect: 'manual'
            });

            const cookies = response.headers.getSetCookie();
            this.cookieSession = cookies.map(c => c.split(';')[0]).join('; ');

            if (this.cookieSession.includes('SESSION')) {
                console.log('✅ Cookies coletados com sucesso!');
                return true;
            } else {
                console.log('❌ Sem cookie retornado.');
                return false;
            }
        } catch (err) {
            console.error('❌ Erro ao fazer login:', err);
            return false;
        }
    }

    connectWebSocket() {
        console.log('🔌 Conectando ao WebSocket Puro entregando nosso Crachá...');

        this.stompClient = new Client({
            brokerURL: 'wss://juliocasas.neppo.com.br/chat/ws/websocket',

            connectHeaders: {
                resource: this.botResource
            },

            webSocketFactory: () => {
                return new WebSocket('wss://juliocasas.neppo.com.br/chat/ws/websocket', {
                    headers: {
                        'Cookie': this.cookieSession,
                        'Origin': 'https://juliocasas.neppo.com.br',
                        'User-Agent': 'Mozilla/5.0'
                    }
                }) as any;
            },
            onConnect: () => {
                console.log('🟢 CONECTADO COM CRACHÁ! Ligando a escuta oficial...');
                this.startListen();
            },
            onStompError: (frame) => {
                console.log('🔴 Erro do STOMP:', frame.headers['message']);
            },
            onWebSocketClose: () => {
                console.log('⚠️ Conexão WebSocket fechada.');
            }
        });

        this.stompClient.activate();
    }

    private startListen() {
        if (!this.stompClient) return;

        console.log(`🎧 Ligando escutas para o resource: ${this.botResource}`);

        this.stompClient.subscribe(`/user/exchange/amq.direct/list.attendance/resource/${this.botResource}`, () => {
            console.log("✅ Servidor reconheceu nossa aba! Recebemos a lista de atendimentos.");
        });

        const messagesQueue = `/user/exchange/amq.direct/chat.message/resource/${this.botResource}`;
        this.stompClient.subscribe(messagesQueue, async (frame) => {
            let payload;
            try {
                payload = JSON.parse(frame.body);
            } catch {
                console.warn(`⚠️ WebSocket recebeu uma mensagem fora do padrão (não é JSON). Conteúdo: ${frame.body}`);
                if (frame.body.includes('#FORCE_DISCONNECT')) {
                    console.error("🔴 A Neppo enviou um comando de desconexão forçada!");
                }
                return;
            }

            if (payload.sendBy === 'user' && payload.originUser === 'WHATSAPP') {
                const clientText = await translator.translate(payload);
                const phoneNumber = payload.externalProtocol;
                const sessionId = payload.sessionId;
                console.log(`\n📩 MENSAGEM DO CLIENTE [${phoneNumber}]: ${clientText}`);
                this.debouncer.add(phoneNumber, clientText, sessionId);
            }
        });

        this.stompClient.subscribe(`/user/exchange/amq.direct/chat.internal.message/resource/${this.botResource}`, () => { });
        this.stompClient.subscribe(`/user/exchange/amq.direct/chat.entity.update/resource/${this.botResource}`, () => { });
        this.stompClient.subscribe(`/user/exchange/notifications/resource/${this.botResource}`, () => { });

        this.stompClient.publish({
            destination: '/app/list.attendance',
            body: '[object Object]'
        });
    }

    private publishText(text: string, sessionId: number) {
        if (!this.stompClient || !this.stompClient.connected) return;

        const createResource = () => Math.random().toString(36).substring(2, 10);

        const payload = {
            toUser: "",
            message: text,
            fromUserResource: this.botResource,
            toUserResource: createResource(),
            sessionId: sessionId,
            command: "SEND_MESSAGE",
            repliedMessage: "",
            contentType: "TEXT",
            fileName: null,
            sendBy: "agent"
        };

        this.stompClient.publish({
            destination: '/app/chat.private.group.RH',
            body: JSON.stringify(payload)
        });
    }

    sendMessage(text: string, sessionId: number) {
        console.log(`💬 Disparando: "${text}"...`);
        this.publishText(text, sessionId);
    }

    async sendMessageSequence(text: string, sessionId: number, phoneNumber?: string) {
        const cleaned = sanitizeOutboundText(text);
        if (!cleaned) {
            logger.warn({ phoneNumber }, '⚠️ Resposta vazia após sanitização; envio cancelado');
            return;
        }

        if (!env.MESSAGE_SPLIT_ENABLED) {
            const blocks = parseMarkedResponse(cleaned);
            this.sendMessage(blocks.join('\n\n'), sessionId);
            return;
        }

        const chunks = prepareOutboundMessages(cleaned);

        if (!/<<<INTRO>>>/i.test(cleaned) && chunks.length === 1) {
            logger.warn(
                { phoneNumber, preview: text.slice(0, 80) },
                '⚠️ Resposta sem marcadores semânticos; enviando como bolha única'
            );
        }

        logger.info(
            {
                phoneNumber,
                bubbleCount: chunks.length,
                previews: chunks.map((c) => c.slice(0, 60)),
            },
            '📤 Enviando sequência humanizada'
        );

        for (let i = 0; i < chunks.length; i++) {
            if (i > 0) {
                const delayMs = randomInterMessageDelayMs();
                logger.info({ phoneNumber, delayMs, index: i }, '⏳ Aguardando antes da próxima bolha');
                await sleep(delayMs);
            }
            console.log(`💬 Disparando bolha ${i + 1}/${chunks.length}: "${chunks[i].slice(0, 80)}..."`);
            this.publishText(chunks[i], sessionId);
        }
    }

    /** Enfileira envio para o mesmo telefone (evita intercalar bolhas de turnos diferentes). */
    enqueueSendSequence(phoneNumber: string, text: string, sessionId: number): Promise<void> {
        return this.enqueueOutbound(phoneNumber, () =>
            this.sendMessageSequence(text, sessionId, phoneNumber)
        );
    }
}

export const neppoWsClient = new NeppoWsClient();
