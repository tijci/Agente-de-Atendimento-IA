import { Client } from "@stomp/stompjs";
import WebSocket from "ws";
import { processAIMessage } from '../agents/graph';

export class NeppoWsClient {
    private cookieSession: string = '';
    private stompClient: Client | null = null;

    private botResource = Math.random().toString(36).substring(2, 10);


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
                console.log('✅ Cookies coletados:', this.cookieSession);
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

    async connectWebSocket() {
        console.log('🔌 Avisando a recepção do Neppo (SockJS Info)...');
        try {
            await fetch('https://juliocasas.neppo.com.br/chat/ws/info', {
                method: 'GET',
                headers: { 'Cookie': this.cookieSession }
            });
        } catch (e) {
            console.log("Aviso falhou, mas vamos tentar conectar mesmo assim!");
        }
        console.log('🔌 Conectando ao WebSocket na nossa rota exclusiva...');
        const serverId = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
        const urlComResource = `wss://juliocasas.neppo.com.br/chat/ws/${serverId}/${this.botResource}/websocket`;
        this.stompClient = new Client({
            brokerURL: urlComResource,
            debug: (str) => { console.log('🐞 STOMP:', str); },

            webSocketFactory: () => {
                const ws = new WebSocket(urlComResource, {
                    headers: {
                        'Cookie': this.cookieSession,
                        'Origin': 'https://juliocasas.neppo.com.br',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    }
                });
                ws.on('unexpected-response', (request, response) => {
                    console.log(`❌ O Neppo rejeitou a conexão WS! HTTP: ${response.statusCode}`);
                });
                return ws as any;
            },
            onConnect: () => {
                console.log('🟢 CONECTADO COM SUCESSO! O Bot está ouvindo...');
                this.iniciarEscuta();
            },
            onStompError: (frame) => {
                console.log('🔴 Erro do STOMP:', frame.headers['message']);
            },
            onWebSocketClose: () => {
                console.log('⚠️ Conexão WebSocket fechada.');
            }
        })
        this.stompClient.activate();

    }
    sendMessage(texto: string, sessionId: number) {
        if (!this.stompClient || !this.stompClient.connected) {
            console.log('❌ O Bot não está conectado no painel!');
            return;
        }
        console.log(`💬 O Fantasma está digitando: "${texto}"...`);
        const geraResource = () => Math.random().toString(36).substring(2, 10);

        const payload = {
            toUser: "",
            message: texto,
            fromUserResource: geraResource(),
            toUserResource: geraResource(),
            sessionId: sessionId,
            command: "SEND_MESSAGE",
            repliedMessage: "",
            contentType: "TEXT",
            fileName: null,
            sendBy: "agent"
        };
        this.stompClient.publish({
            destination: '/app/chat.private.group.TesteTI',
            body: JSON.stringify(payload)
        });
        console.log('✅ Mensagem Fantasma enviada para o Neppo!');

    }


    private iniciarEscuta() {
        if (!this.stompClient) return;

        console.log(`🎧 Ligando escutas para o resource: ${this.botResource}`);

        // 1. Escuta a lista de atendimentos (Obrigatório para o servidor nos registrar)
        this.stompClient.subscribe(`/user/exchange/amq.direct/list.attendance/resource/${this.botResource}`, (frame) => {
            console.log("✅ Servidor reconheceu nossa aba! Recebemos a lista de atendimentos.");
        });

        // 2. Escuta as mensagens de chat!
        const filaDeMensagens = `/user/exchange/amq.direct/chat.message/resource/#`;
        this.stompClient.subscribe(filaDeMensagens, async (frame) => {
            const payload = JSON.parse(frame.body);

            console.log("\n📦 PAYLOAD STOMP BRUTO RECEBIDO:", JSON.stringify(payload, null, 2));

            // Só responde se for o cliente no WhatsApp
            if (payload.sendBy === 'user' && payload.originUser === 'WHATSAPP') {
                const textoCliente = payload.message;
                const telefone = payload.externalProtocol;
                const idDaSessao = payload.sessionId;
                console.log(`\n📩 MENSAGEM RECEBIDA DO CLIENTE [${telefone}]: ${textoCliente}`);

                try {
                    const respostaDaIA = await processAIMessage(telefone, textoCliente);
                    this.sendMessage(respostaDaIA, idDaSessao);
                } catch (error) {
                    console.log('❌ Erro no LangGraph:', error);
                }
            }
        });

        // 3. Outras filas que o painel escuta (pode ser necessário para não ser desconectado)
        this.stompClient.subscribe(`/user/exchange/amq.direct/chat.internal.message/resource/${this.botResource}`, () => { });
        this.stompClient.subscribe(`/user/exchange/amq.direct/chat.entity.update/resource/${this.botResource}`, () => { });
        this.stompClient.subscribe(`/user/exchange/notifications/resource/${this.botResource}`, () => { });

        // 4. Dá o "Cutucão" inicial no servidor para ele saber que estamos prontos
        this.stompClient.publish({
            destination: '/app/list.attendance',
            body: '[object Object]'
        });
    }
}

export const neppoWsClient = new NeppoWsClient();