import { Worker } from "worker_threads";
import { tool } from "@langchain/core/tools";
import { z } from 'zod';
import path from 'path';

const aiWorker = new Worker(path.join(__dirname, '../../workers/ai-worker.ts'), {
    execArgv: ['--require', 'tsx/cjs']
});
aiWorker.on('error', (err) => console.error('❌ [WORKER] Erro inesperado na Thread da IA:', err));

const searchSchema = z.object({
    pedido_livre: z.string().optional().describe("A frase do cliente com o que ele deseja (opcional se passar foto)"),
    codigo: z.string().optional().describe("Código numérico (ListingID), APENAS se o cliente passar um"),
    foto_url: z.string().optional().describe("URL da foto enviada pelo cliente para fazermos busca visual"),
})

export const searchPropertiesTool = tool(
    async ({ pedido_livre, foto_url, codigo }) => {
        console.log(`\n🔎 [FERRAMENTA]: Pedido recebido | Texto: "${pedido_livre}" | Cod: ${codigo} | Foto: ${foto_url}`);
        let command: string;
        let payload: object;

        if (codigo) {
            command = 'BUSCAR_CODIGO';
            payload = { command, codigo };
        } else if (foto_url) {
            command = 'BUSCAR_FOTO';
            payload = { command, foto_url };
        } else if (pedido_livre) {
            command = 'BUSCAR_SEMANTICA';
            payload = { command, text: pedido_livre };
        } else {
            return "Por favor, envie uma foto ou diga o que está procurando.";
        }
        return new Promise<string>((resolve, reject) => {
            aiWorker.postMessage(payload);
            aiWorker.once('message', (workerAnswer) => {
                if (workerAnswer.status === 'CONCLUIDO') {
                    if (!workerAnswer.data || workerAnswer.data.length === 0) {
                        resolve("Nenhum imóvel compatível encontrado no catálogo.");
                    } else {
                        resolve(JSON.stringify(workerAnswer.data));
                    }
                }
            });
            aiWorker.once('error', (erro) => {
                console.error("❌ Worker falhou ao processar pedido:", erro);
                reject("Sistema de buscas temporariamente inoperante.");
            });
        });
    }, {
    name: "buscar_imoveis",
    description: "Busca na base oficial da imobiliária. Use APENAS quando tiver Tipo e Bairro, ou o Código.",
    schema: searchSchema,
}
)