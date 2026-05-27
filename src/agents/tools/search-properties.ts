import { Worker } from "worker_threads";
import { tool } from "@langchain/core/tools";
import { z } from 'zod';
import { scrapePortalPage } from '../../utils/portal-scraper';
import path from 'path';

const aiWorker = new Worker(path.join(__dirname, '../../workers/ai-worker.ts'), {
    execArgv: ['--require', 'tsx/cjs']
});
aiWorker.on('error', (err) => console.error('❌ [WORKER] Erro inesperado na Thread da IA:', err));

let requestSeq = 0;

function callWorker(payload: object): Promise<string> {
    const requestId = `req_${Date.now()}_${++requestSeq}`;

    return new Promise((resolve, reject) => {
        const onMessage = (workerAnswer: any) => {
            if (workerAnswer.requestId !== requestId) return;

            aiWorker.off("message", onMessage);
            aiWorker.off("error", onError);

            if (workerAnswer.status !== "CONCLUIDO") {
                reject("Sistema de buscas temporariamente inoperante.");
                return;
            }

            const data = workerAnswer.data;
            const isEmptyArray = Array.isArray(data) && data.length === 0;
            const isEmptyLegacyResult = !Array.isArray(data) && !data?.matchType && data?.items?.length === 0;

            if (!data || isEmptyArray || isEmptyLegacyResult) {
                resolve("Nenhum imóvel compatível encontrado no catálogo.");
                return;
            }

            resolve(JSON.stringify(data));
        };

        const onError = (erro: Error) => {
            aiWorker.off("message", onMessage);
            aiWorker.off("error", onError);
            reject(erro);
        };

        aiWorker.on("message", onMessage);
        aiWorker.on("error", onError);
        aiWorker.postMessage({ ...payload, requestId });
    });
}


const searchSchema = z.object({
    pedido_livre: z.string().optional().describe("A frase do cliente com o que ele deseja (opcional se passar foto)"),
    codigo: z.string().optional().describe("Código numérico (ListingID), APENAS se o cliente passar um"),
    foto_url: z.string().optional().describe("URL da foto enviada pelo cliente para fazermos busca visual"),
    link_url: z.string().optional().describe("URL de portal imobiliário enviada pelo cliente (ZAP, VivaReal, ImovelWeb, OLX etc.)")
})

export const searchPropertiesTool = tool(
    async ({ pedido_livre, foto_url, codigo, link_url }) => {
        console.log(`\n🔎 [FERRAMENTA]: Pedido recebido | Texto: "${pedido_livre}" | Cod: ${codigo} | Foto: ${foto_url} | Link: ${link_url}`);
        let command: string;
        let payload: object;

        if (codigo) {
            command = 'BUSCAR_CODIGO';
            payload = { command, codigo };
        } else if (link_url) {
            const scraped = await scrapePortalPage(link_url);
 
            // Caminho feliz: código extraído do HTML → busca direta
            if (scraped.codigo) {
                console.log(`🔑 [FERRAMENTA] Código extraído do portal: ${scraped.codigo}`);
                return callWorker({ command: 'BUSCAR_CODIGO', codigo: scraped.codigo });
            }
 
            // Fallback semântico: título + texto da página
            const query = [scraped.titulo, scraped.textoRelevante?.slice(0, 400)]
                .filter(Boolean)
                .join(' ')
                .trim();
 
            if (query) {
                console.log(`🔍 [FERRAMENTA] Fallback semântico com texto da página`);
                return callWorker({ command: 'BUSCAR_SEMANTICA', text: query });
            }
 
            return 'Não consegui acessar o link do portal. Poderia informar o código ou o endereço do imóvel?';
        } else if (foto_url) {
            command = 'BUSCAR_FOTO';
            payload = { command, foto_url };
        } else if (pedido_livre) {
            command = 'BUSCAR_SEMANTICA';
            payload = { command, text: pedido_livre };
        } else {
            return "Por favor, envie uma foto, link ou diga o que está procurando.";
        }
        return callWorker(payload);
    }, {
    name: "buscar_imoveis",
    description: "Busca na base oficial da imobiliária. Use com foto_url quando o cliente enviar imagem/print; use codigo para código; use pedido_livre quando tiver tipo e região/endereço.",
    schema: searchSchema,
}
)
