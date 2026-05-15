/* BLOCO: A CONEXÃO PURA COM O CRACHÁ (neppo-ws-client.ts) */

import { Client } from "@stomp/stompjs";
import WebSocket from "ws";
import { processAIMessage } from '../agents/graph';
import { MessageDebouncer } from '../utils/message-debouncer';

export class NeppoWsClient {
    private cookieSession: string = '';
    private stompClient: Client | null = null;
    private botResource = Math.random().toString(36).substring(2, 10);
    private debouncer = new MessageDebouncer(async (phoneNumber, fullMessage, sessionId) => {
        try {
            const AIResponse = await processAIMessage(phoneNumber, fullMessage);
            this.sendMessage(AIResponse, sessionId);
        } catch (error) {
            console.log('❌ Erro no LangGraph:', error);
        }
    })

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

            // 🔥 O SEGREDO ESTAVA AQUI O TEMPO TODO 🔥
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

        // 1. Escuta a lista de atendimentos
        this.stompClient.subscribe(`/user/exchange/amq.direct/list.attendance/resource/${this.botResource}`, (frame) => {
            console.log("✅ Servidor reconheceu nossa aba! Recebemos a lista de atendimentos.");
        });

        // 2. Escuta as mensagens de chat!
        const messagesQueue = `/user/exchange/amq.direct/chat.message/resource/${this.botResource}`;
        this.stompClient.subscribe(messagesQueue, async (frame) => {
            const payload = JSON.parse(frame.body);

            if (payload.sendBy === 'user' && payload.originUser === 'WHATSAPP') {
                const clientText = payload.message;
                const phoneNumber = payload.externalProtocol;
                const sessionId = payload.sessionId;
                console.log(`\n📩 MENSAGEM DO CLIENTE [${phoneNumber}]: ${clientText}`);
                this.debouncer.add(phoneNumber, clientText, sessionId);


            }
        });

        // 3. Outras filas obrigatórias do painel
        this.stompClient.subscribe(`/user/exchange/amq.direct/chat.internal.message/resource/${this.botResource}`, () => { });
        this.stompClient.subscribe(`/user/exchange/amq.direct/chat.entity.update/resource/${this.botResource}`, () => { });
        this.stompClient.subscribe(`/user/exchange/notifications/resource/${this.botResource}`, () => { });

        // 4. Bate o ponto
        this.stompClient.publish({
            destination: '/app/list.attendance',
            body: '[object Object]'
        });
    }

    sendMessage(text: string, sessionId: number) {
        if (!this.stompClient || !this.stompClient.connected) return;

        console.log(`💬 Disparando: "${text}"...`);
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

}

export const neppoWsClient = new NeppoWsClient();
