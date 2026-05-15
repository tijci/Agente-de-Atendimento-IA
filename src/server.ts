import 'dotenv/config';
import express from 'express'
import { neppoWebhookHandler } from './webhook/neppo-handler';
import { neppoWsClient } from './integrations/neppo-ws-client';
import { neppoPresence } from './integrations/neppo-presence';

const app = express();
const PORT = process.env.PORT || 5173;

app.use(express.json());

app.get("/health", (req, res) => {
    res.json({ status: 'ok', message: 'Servidor IA operante!' });
});

app.post('/webhook/neppo', neppoWebhookHandler);

app.listen(Number(PORT), '127.0.0.1', async () => {
    console.log(`🚀 ServidorIA rodando em http://127.0.0.1:${PORT}`);
    const logado = await neppoWsClient.login();
    if (logado) {
        neppoWsClient.connectWebSocket();
    }
    await neppoPresence.start();

});