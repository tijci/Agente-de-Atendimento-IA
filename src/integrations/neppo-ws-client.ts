import { Client } from "@stomp/stompjs";
import WebSocket from "ws";

export class NeppoWsClient {
    private cookieSession: string = '';
    private stompClient: Client | null = null;

    async login() {
        console.log('🔄 Tentando fazer login como Agente Fantasma...');
        const passwordBase64 = Buffer.from('TesteTI123#').toString('base64');
        const body = new URLSearchParams({
            username: 'testeti.supervisoragente',
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

    connectWebSocket() {
        console.log('🔌 Conectando ao WebSocket interno...');
        this.stompClient = new Client({
            brokerURL: 'wss://juliocasas.neppo.com.br/chat/ws/websocket',
            debug: (str) => { console.log('🐞 STOMP_LOG:', str); },

            webSocketFactory: () => {
                const ws = new WebSocket('wss://juliocasas.neppo.com.br/chat/ws/websocket', {
                    headers: {
                        'Cookie': this.cookieSession,
                        'Origin': 'https://juliocasas.neppo.com.br',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    }
                });
                ws.on('unexpected-response', (request, response) => {
                    console.log(`❌ O Neppo rejeitou a conexão! Status HTTP: ${response.statusCode} - ${response.statusMessage}`);
                });
                return ws as any;
            },
            onConnect: () => {
                console.log('🟢 CONECTADO COM SUCESSO! O Bot está online no painel Neppo!');
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

}

export const neppoWsClient = new NeppoWsClient();