import { tool } from "@langchain/core/tools";
import { z } from 'zod';
import Papa from 'papaparse';
import { pipeline } from "@xenova/transformers"

const searchSchema = z.object({
    pedido_livre: z.string().describe("A frase do cliente com o que ele deseja (ex: 'Quero um apê calmo de 2 quartos no Campolim')"),
    codigo: z.string().optional().describe("Código numérico (ListingID), APENAS se o cliente passar um"),
})

let extractor: any = null;
let vetorDeImoveis: any[] = [];
let isCarregando = false;

function calcularSimilaridade(vecA: number[], vecB: number[]) {
    let dotProduct = 0, normA = 0, normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));

}

async function sincronizarVetores() {
    if (vetorDeImoveis.length > 0 || isCarregando) return;
    isCarregando = true;
    console.log("📥 [SISTEMA] Acordando IA Local (baixando modelo open-source)...");
    extractor = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');
    console.log("📥 [SISTEMA] Lendo CSV e vetorizando imóveis de Locação (Pode levar alguns segundos na 1ª vez)...");
    const response = await fetch("https://tijci.github.io/auto-xml-ksi-format/docs/imoveis.csv");
    const csvText = await response.text();
    const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });

    const imoveisLocacao = parsed.data.filter((i: any) => i.tipo_transacao === "For Rent") as any[];
    // Transforma cada imóvel em Matemática
    for (const imovel of imoveisLocacao) {
        // Criamos o 'Resumo' que a IA vai interpretar
        const descResumida = imovel.descricao ? imovel.descricao.substring(0, 200) : "";

        const textoParaVetor = `Imóvel: ${imovel.tipo_imovel}. Bairro: ${imovel.bairro}. Quartos: ${imovel.quartos}. Título: ${imovel.titulo}. Descrição: ${descResumida}`;

        const output = await extractor(textoParaVetor, { pooling: 'mean', normalize: true });
        const vetor = Array.from(output.data) as number[];

        vetorDeImoveis.push({
            id: imovel.id ? imovel.id.replace(/\D/g, '') : "",
            titulo: imovel.titulo,
            tipo_imovel: imovel.tipo_imovel,
            bairro: imovel.bairro,
            preco: imovel.preco,
            quartos: imovel.quartos,
            vetor: vetor
        });
    }
    console.log(`✅ [SISTEMA] Banco Vetorial pronto! ${vetorDeImoveis.length} imóveis na memória RAM.`);

}



export const searchPropertiesTool = tool(
    async ({ pedido_livre, codigo }) => {
        console.log(`\n🔎 [SEMÂNTICA]: Ana pediu busca livre: "${pedido_livre}" | Cod: ${codigo}`);
        try {
            await sincronizarVetores();
            if (codigo) {
                const exato = vetorDeImoveis.find(i => i.id === codigo.replace(/\D/g, ''));
                if (exato) {
                    return JSON.stringify([{ ListingID: exato.id, Title: exato.titulo, PropertyType: exato.tipo_imovel, Bairro: exato.bairro, Valor: exato.preco, Quartos: exato.quartos }]);
                }
                return "Nenhum imóvel encontrado com esse código.";
            }
            const pedidoSeguro = pedido_livre.slice(0, 300);
            const outputPedido = await extractor(pedidoSeguro, { pooling: 'mean', normalize: true });
            const vetorPedido = Array.from(outputPedido.data) as number[];
            const imoveisComScore = vetorDeImoveis.map(imovel => {
                const score = calcularSimilaridade(vetorPedido, imovel.vetor);
                return { ...imovel, score };
            });
            // 3. Ordena do mais parecido (Score Maior) para o menos parecido
            imoveisComScore.sort((a, b) => b.score - a.score);
            // 4. A Ana recebe os 3 melhores matches!
            const top3 = imoveisComScore.slice(0, 3).map(i => ({
                ListingID: i.id,
                Title: i.titulo,
                PropertyType: i.tipo_imovel,
                Bairro: i.bairro,
                Valor: i.preco,
                Quartos: i.quartos,
                Relevancia: `${(i.score * 100).toFixed(1)}%` // A Ana vai ver a precisão matemática!
            }));
            if (top3.length === 0 || imoveisComScore[0].score < 0.2) {
                return "A busca não encontrou nada parecido com o que o cliente quer. Ofereça ajuda humana.";
            }

            return JSON.stringify(top3);
        } catch (error) {
            console.error("❌ Erro na busca do CSV:", error);
            return "Ocorreu um erro no sistema. Diga ao cliente que o sistema de buscas está instável e transfira o atendimento.";
        }
    },
    {
        name: "buscar_imoveis",
        description: "Busca na base oficial da imobiliária. Use APENAS quando tiver Tipo e Bairro, ou o Código.",
        schema: searchSchema,
    }
);