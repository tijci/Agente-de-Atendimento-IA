import { parentPort } from "worker_threads";
import { pipeline, RawImage, CLIPModel, AutoProcessor, AutoTokenizer } from '@xenova/transformers';
import Papa from 'papaparse';
import fs from 'fs';
import path from 'path';


let extractor: any = null;
let clipModel: any = null;
let clipProcessor: any = null;
let clipTokenizer: any = null;
let vetorDeImoveis: any[] = [];
let isCarregando = false;

const CACHE_PATH = path.join(process.cwd(), 'data', 'vetores-cache.json');

const STOP_WORDS = new Set([
    "vi", "um", "para", "alugar", "na", "rua", "de", "perto", "da", "no", "esta", "disponivel",
    "o", "a", "em", "com", "que", "uma", "uns", "do", "dos", "das", "sobre", "como", "mais", "tem",
    "gostaria", "ver", "casa", "apartamento", "terreno", "apto", "lote", "chacara", "sitio", "sobrado"
]);

function calcularSimilaridade(vecA: number[], vecB: number[]) {
    // Calcula o Cosseno de Similaridade: mede o ângulo entre dois vetores (0 = nada similar, 1 = idêntico)
    let dotProduct = 0, normA = 0, normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function normalizarTexto(txt: string): string {
    return txt.toLowerCase().normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s]/g, " ");
}

function extrairEquivalentesNumericos(texto: string): string {
    const porExtenso: { [key: string]: string } = {
        "um": "1", "dois": "2", "tres": "3", "quatro": "4", "cinco": "5",
        "seis": "6", "sete": "7", "oito": "8", "nove": "9", "dez": "10",
        "onze": "11", "doze": "12", "treze": "13", "quatorze": "14", "quinze": "15",
        "dezesseis": "16", "dezessete": "17", "dezoito": "18", "dezenove": "19",
        "vinte": "20", "trinta": "30", "quarenta": "40", "cinquenta": "50",
        "sessenta": "60", "setenta": "70", "oitenta": "80", "noventa": "90"
    };
    let textoNormalizado = normalizarTexto(texto);
    let equivalentes: string[] = [];
    const dezenas = ["vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
    const unidades = ["um", "dois", "tres", "quatro", "cinco", "seis", "sete", "oito", "nove"];
    for (const d of dezenas) {
        for (const u of unidades) {
            if (textoNormalizado.includes(`${d} e ${u}`)) {
                equivalentes.push((parseInt(porExtenso[d]) + parseInt(porExtenso[u])).toString());
            }
        }
    }
    for (const [extenso, digito] of Object.entries(porExtenso)) {
        if (new RegExp(`\\b${extenso}\\b`, "g").test(textoNormalizado)) equivalentes.push(digito);
    }
    const digitosEncontrados = textoNormalizado.match(/\b\d+\b/g);
    if (digitosEncontrados) {
        const unidadesExt = ["", "um", "dois", "tres", "quatro", "cinco", "seis", "sete", "oito", "nove"];
        const dezenasExt = ["", "dez", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
        const especiaisExt = ["dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
        for (const digitoStr of digitosEncontrados) {
            const num = parseInt(digitoStr);
            if (num > 0 && num < 100) {
                let extenso = num < 10 ? unidadesExt[num] : num < 20 ? especiaisExt[num - 10]
                    : num % 10 === 0 ? dezenasExt[Math.floor(num / 10)] : `${dezenasExt[Math.floor(num / 10)]} e ${unidadesExt[num % 10]}`;
                equivalentes.push(extenso);
            }
        }
    }
    return equivalentes.join(" ");
}

async function extrairVetorImagem(imageUrl: string): Promise<number[]> {
    const img = await RawImage.read(imageUrl);
    const imageInputs = await clipProcessor(img);
    const textInputs = await clipTokenizer([""]);
    const output = await clipModel({ ...textInputs, pixel_values: imageInputs.pixel_values });
    return Array.from(output.image_embeds.data) as number[];
}

async function sincronizarVetores() {
    if (vetorDeImoveis.length > 0 || isCarregando) return;
    isCarregando = true;
    let cache: { [key: string]: any } = {};
    try {
        if (fs.existsSync(CACHE_PATH)) {
            cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
            console.log("📂 [WORKER] Cache de vetores carregado!");
        }
    } catch (e) { console.warn("⚠️ [WORKER] Erro ao ler cache:", e); }
    console.log("📥 [WORKER] Lendo CSV de imóveis...");
    const response = await fetch("https://tijci.github.io/auto-xml-ksi-format/docs/imoveis.csv");
    const csvText = await response.text();
    const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
    const imoveisFiltrados = parsed.data.filter((i: any) => i.tipo_transacao === "For Rent" || i.tipo_transacao === "For Sale") as any[];
    console.log(`📥 [WORKER] Processando ${imoveisFiltrados.length} imóveis...`);
    let cacheAlterado = false;
    let contadorDeRespiro = 0;
    for (const imovel of imoveisFiltrados) {
        contadorDeRespiro++;
        const idOriginal = imovel.id || "";
        const idLimpo = idOriginal.replace(/\D/g, '');
        const descResumida = imovel.descricao ? imovel.descricao.substring(0, 800) : "";
        const transacaoTexto = imovel.tipo_transacao === "For Rent" ? "Aluguel / Locação" : "Venda / Compra";
        const textoParaVetor = `Imóvel: ${imovel.tipo_imovel}. Cidade: ${imovel.cidade}. Operação: ${transacaoTexto}. Bairro: ${imovel.bairro}. Endereço: ${imovel.endereco || ""}. Quartos: ${imovel.quartos}. Título: ${imovel.titulo}. Descrição: ${descResumida}`;
        const fotosAdicionaisList = imovel.fotos_adicionais ? imovel.fotos_adicionais.split("|") : [];
        const todasFotos = [imovel.imagem_url, ...fotosAdicionaisList].filter(Boolean).slice(0, 6);
        const imagensHash = todasFotos.join("|");
        let vetor: number[] = [];
        let vectorImages: number[][] = [];
        const cached = cache[idOriginal] || cache[idLimpo];
        const textUnchanged = cached && cached.textoParaVetor === textoParaVetor;
        const imagesUnchanged = cached && cached.imagensHash === imagensHash;
        if (textUnchanged && imagesUnchanged && cached.vetorTexto && cached.vetoresImagens?.length > 0) {
            vetor = cached.vetorTexto;
            vectorImages = cached.vetoresImagens;
        } else {
            cacheAlterado = true;
            const pct = ((contadorDeRespiro / imoveisFiltrados.length) * 100).toFixed(1);
            console.log(`⚡ [WORKER] [${contadorDeRespiro}/${imoveisFiltrados.length} - ${pct}%] Atualizando ${idOriginal}...`);
            if (!extractor) {
                console.log("📥 [WORKER] Carregando modelo de texto...");
                extractor = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');
            }
            vetor = textUnchanged && cached?.vetorTexto
                ? cached.vetorTexto
                : Array.from((await extractor(textoParaVetor, { pooling: 'mean', normalize: true })).data) as number[];
            if (!imagesUnchanged && todasFotos.length > 0) {
                if (!clipModel) {
                    console.log("📥 [WORKER] Carregando modelo visual...");
                    clipModel = await CLIPModel.from_pretrained('Xenova/clip-vit-large-patch14');
                    clipProcessor = await AutoProcessor.from_pretrained('Xenova/clip-vit-large-patch14');
                    clipTokenizer = await AutoTokenizer.from_pretrained('Xenova/clip-vit-large-patch14');
                }
                for (const url of todasFotos) {
                    try { vectorImages.push(await extrairVetorImagem(url)); }
                    catch (err) { console.warn(`⚠️ [WORKER] Imagem não carregada: ${url}`); }
                }
            } else if (cached?.vetoresImagens) {
                vectorImages = cached.vetoresImagens;
            }
            cache[idOriginal] = { vetorTexto: vetor, vetoresImagens: vectorImages, textoParaVetor, imagensHash };
        }
        vetorDeImoveis.push({
            id: idOriginal, tipo_transacao: imovel.tipo_transacao, titulo: imovel.titulo,
            tipo_imovel: imovel.tipo_imovel, bairro: imovel.bairro, preco: imovel.preco, quartos: imovel.quartos,
            imagem_url: imovel.imagem_url, fotos_adicionais: imovel.fotos_adicionais || "",
            endereco: imovel.endereco, numero: imovel.numero, complemento: imovel.complemento,
            cidade: imovel.cidade, empreendimento: imovel.empreendimento, descricao: imovel.descricao,
            vetorTexto: vetor, vetoresImagens: vectorImages
        });
        // Respiro do Event Loop a cada 20 imóveis
        if (contadorDeRespiro % 20 === 0) {
            console.log(`--- 🧹 [WORKER] Respiro: ${contadorDeRespiro}/${imoveisFiltrados.length} ---`);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
    if (cacheAlterado) {
        try {
            fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf-8');
            console.log("💾 [WORKER] Cache salvo em disco!");
        } catch (e) { console.warn("⚠️ [WORKER] Erro ao salvar cache:", e); }
    }
    console.log(`✅ [WORKER] Banco Vetorial pronto! ${vetorDeImoveis.length} imóveis carregados.`);
}



console.log("👷‍♂️ [WORKER] IA iniciada! Carregando modelos vetoriais em Thread separada...");
sincronizarVetores().catch(err => console.error("❌ [WORKER] Erro fatal na sincronização:", err));


parentPort?.on('message', async (message) => {

    if (message.command === 'BUSCAR_CODIGO') {
        const codigoLimpo = message.codigo.replace(/\D/g, '');
        const encontrados = vetorDeImoveis.filter(i =>
            i.id.toLowerCase() === message.codigo.toLowerCase() || i.id.replace(/\D/g, '') === codigoLimpo
        ).map(i => ({ ListingID: i.id, Title: i.titulo, PropertyType: i.tipo_imovel, Bairro: i.bairro, Valor: i.preco, Transacao: i.tipo_transacao === 'For Rent' ? 'Locação' : 'Venda', Quartos: i.quartos }));
        parentPort?.postMessage({ status: 'CONCLUIDO', data: encontrados.length > 0 ? encontrados : null });
    }

    if (message.command === 'BUSCAR_FOTO') {
        if (!clipModel) {
            clipModel = await CLIPModel.from_pretrained('Xenova/clip-vit-large-patch14');
            clipProcessor = await AutoProcessor.from_pretrained('Xenova/clip-vit-large-patch14');
            clipTokenizer = await AutoTokenizer.from_pretrained('Xenova/clip-vit-large-patch14');
        }
        const vetorCliente = await extrairVetorImagem(message.foto_url);
        const resultado = vetorDeImoveis
            .filter(i => i.vetoresImagens?.length > 0)
            .map(i => ({ ...i, score: Math.max(...i.vetoresImagens.map((v: number[]) => calcularSimilaridade(vetorCliente, v))) }))
            .filter(i => i.score >= 0.60)
            .sort((a, b) => b.score - a.score).slice(0, 3)
            .map(i => ({ ListingID: i.id, Title: i.titulo, Transacao: i.tipo_transacao === 'For Rent' ? 'Locação' : 'Venda', Bairro: i.bairro, Valor: i.preco, LinkFoto: i.imagem_url, Semelhanca: `${(i.score * 100).toFixed(1)}%` }));
        parentPort?.postMessage({ status: 'CONCLUIDO', data: resultado });
    }

    if (message.command === 'BUSCAR_SEMANTICA') {
        const pedido = message.text;
        const outputTexto = await extractor(pedido, { pooling: 'mean', normalize: true });
        const vetorPedido = Array.from(outputTexto.data) as number[];
        const queryNorm = normalizarTexto(pedido);
        const queryWords = queryNorm.split(/\s+/).filter(w => w.length > 1 && !STOP_WORDS.has(w));
        const queryIsApartment = queryNorm.includes("apartamento") || queryNorm.includes("apto");
        const queryIsHouse = queryNorm.includes("casa");
        const queryIsTerrain = queryNorm.includes("terreno");
        const queryIsRent = queryNorm.includes("alug") || queryNorm.includes("locac");
        const queryIsSale = queryNorm.includes("compr") || queryNorm.includes("vend");
        const resultado = vetorDeImoveis.map(imovel => {
            const semanticScore = calcularSimilaridade(vetorPedido, imovel.vetorTexto);
            const textoComparar = normalizarTexto(`${imovel.tipo_imovel} ${imovel.cidade} ${imovel.bairro} ${imovel.endereco} ${imovel.titulo} ${imovel.descricao}`) + " " + extrairEquivalentesNumericos(imovel.endereco || "");
            const matchCount = queryWords.filter(w => textoComparar.includes(w)).length;
            const keywordBoost = Math.min(matchCount * 0.15, 0.60);
            const typeNorm = normalizarTexto(imovel.tipo_imovel || "");
            let typeMultiplier = 1.0;
            if (queryIsApartment && !typeNorm.includes("apartment")) typeMultiplier = 0.1;
            if (queryIsHouse && !typeNorm.includes("house") && !typeNorm.includes("casa")) typeMultiplier = 0.1;
            if (queryIsTerrain && !typeNorm.includes("land") && !typeNorm.includes("terreno")) typeMultiplier = 0.1;
            let transMultiplier = 1.0;
            if (queryIsRent && imovel.tipo_transacao !== "For Rent") transMultiplier = 0.1;
            if (queryIsSale && imovel.tipo_transacao !== "For Sale") transMultiplier = 0.1;
            return { ...imovel, score: (semanticScore + keywordBoost) * typeMultiplier * transMultiplier };
        }).filter(i => i.score >= 0.25).sort((a, b) => b.score - a.score).slice(0, 3)
            .map(i => ({ ListingID: i.id, Title: i.titulo, Transacao: i.tipo_transacao === 'For Rent' ? 'Locação' : 'Venda', Bairro: i.bairro, Valor: i.preco, LinkFoto: i.imagem_url, Semelhanca: `${(i.score * 100).toFixed(1)}%` }));
        parentPort?.postMessage({ status: 'CONCLUIDO', data: resultado });
    }
});