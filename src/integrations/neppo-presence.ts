import puppeteer, { Browser, Page } from 'puppeteer';
import { logger } from '../utils/logger';

class NeppoPresence {
    private browser: Browser | null = null;
    private page: Page | null = null;
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private isRunning = false;

    async start() {
        if (this.isRunning) return;
        this.isRunning = true;

        try {
            logger.info('👻 Iniciando Agente Fantasma (navegador headless)...');

            this.browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
            });

            this.page = await this.browser.newPage();
            await this.page.goto('https://juliocasas.neppo.com.br/chat', {
                waitUntil: 'networkidle2',
                timeout: 30000
            });
            const loginResult = await this.page.evaluate(async () => {
                const passwordBase64 = btoa('TesteTI123#');
                const body = new URLSearchParams({
                    username: 'teste.ti',
                    password: passwordBase64,
                    verificationToken: 'null'
                });
                const response = await fetch('/chat/login', {
                    method: 'POST',
                    body: body,
                    redirect: 'manual'
                });
                return { status: response.status, ok: response.ok };
            });
            logger.info({ loginResult }, '🔐 Login do Fantasma executado');
            await this.page.goto('https://juliocasas.neppo.com.br/chat', {
                waitUntil: 'networkidle2',
                timeout: 30000
            });
            logger.info('✅ Agente Fantasma está ONLINE no painel Neppo!');
            this.heartbeatInterval = setInterval(async () => {
                try {
                    if (this.page) {
                        await this.page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
                        logger.info('💓 Heartbeat: Agente Fantasma ainda online');

                    }
                } catch (err) {
                    logger.error({ err }, '❌ Heartbeat falhou, reiniciando Fantasma...');
                    await this.restart();
                }
            }, 25 * 60 * 1000);

        } catch (err) {
            logger.error({ err }, '❌ Erro ao iniciar Agente Fantasma');
            this.isRunning = false;
            setTimeout(() => this.start(), 30000);
        }
    }

    async restart() {
        await this.stop();
        await this.start();
    }

    async stop() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }

        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.page = null;
        }
        this.isRunning = false;
        logger.info('🔴 Agente Fantasma desconectado');

    }
}

export const neppoPresence = new NeppoPresence();
