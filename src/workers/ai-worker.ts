/**
 * Worker thread: catálogo vetorial de imóveis, busca semântica, CLIP e OCR.
 * @module workers/ai-worker
 * @see docs/AI-WORKER.md
 */
import sharp from "sharp";
import { createWorker } from "tesseract.js";
import { parentPort } from "worker_threads";
import Papa from 'papaparse';
import fs from 'fs';
import path from 'path';


let extractor: any = null;
let clipModel: any = null;
let clipProcessor: any = null;
let clipTokenizer: any = null;
let vetorDeImoveis: any[] = [];
let isCarregando = false;
let transformers: any = null;

const CACHE_PATH = path.join(process.cwd(), 'data', 'vetores-cache.json');

const STOP_WORDS = new Set([
    "vi", "um", "para", "alugar", "na", "rua", "de", "perto", "da", "no", "esta", "disponivel",
    "o", "a", "em", "com", "que", "uma", "uns", "do", "dos", "das", "sobre", "como", "mais", "tem",
    "gostaria", "ver", "casa", "apartamento", "terreno", "apto", "lote", "chacara", "sitio", "sobrado"
]);


const EXACT_THRESHOLD = Number(process.env.IMAGE_EXACT_THRESHOLD || "0.70");
const CANDIDATE_THRESHOLD = Number(process.env.IMAGE_CANDIDATE_THRESHOLD || "0.58");
const EXACT_MARGIN = Number(process.env.IMAGE_EXACT_MARGIN || "0.04");
const OCR_TEXT_CANDIDATE_THRESHOLD = Number(process.env.OCR_TEXT_CANDIDATE_THRESHOLD || "0.35");


async function getTransformers() {
    if (!transformers) {
        transformers = await import('@xenova/transformers');
    }
    return transformers;
}

async function carregarModeloTexto() {
    if (!extractor) {
        const { pipeline } = await getTransformers();
        extractor = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');
    }
    return extractor;
}

async function carregarModeloVisual() {
    if (!clipModel) {
        const { CLIPModel, AutoProcessor, AutoTokenizer } = await getTransformers();
        clipModel = await CLIPModel.from_pretrained('Xenova/clip-vit-large-patch14');
        clipProcessor = await AutoProcessor.from_pretrained('Xenova/clip-vit-large-patch14');
        clipTokenizer = await AutoTokenizer.from_pretrained('Xenova/clip-vit-large-patch14');
    }
}

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

type TransactionSignal = "For Rent" | "For Sale";
type PropertyIntent =
    | "commercial_house"
    | "house"
    | "apartment"
    | "land"
    | "warehouse"
    | "office"
    | "commercial";

interface SearchSignals {
    normalized: string;
    codigo?: string;
    transacao?: TransactionSignal;
    tipo?: PropertyIntent;
    cidade?: string;
    addressTokens: string[];
    valores: number[];
    areas: number[];
    hasPortalText: boolean;
}

const CITY_HINTS = [
    "aracoiaba da serra",
    "salto de pirapora",
    "vargem grande paulista",
    "sao roque",
    "votorantim",
    "sorocaba",
    "mairinque",
    "ipero",
    "itu",
];

const ADDRESS_TOKEN_STOP_WORDS = new Set([
    ...STOP_WORDS,
    "avenida",
    "av",
    "rua",
    "rodovia",
    "estrada",
    "alameda",
    "travessa",
    "doutor",
    "doutora",
    "dr",
    "dra",
    "professor",
    "professora",
    "r",
    "rs",
    "valor",
    "preco",
]);

function parseNumeroBR(valor: string): number | null {
    let limpo = valor.replace(/\s+/g, "").replace(/[^\d,.]/g, "");
    if (!limpo) return null;

    if (limpo.includes(",") && limpo.includes(".")) {
        limpo = limpo.replace(/\./g, "").replace(",", ".");
    } else if (limpo.includes(",")) {
        limpo = limpo.replace(",", ".");
    } else if (limpo.includes(".")) {
        const partes = limpo.split(".");
        const ultimo = partes[partes.length - 1];
        if (partes.length > 1 && ultimo.length === 3) {
            limpo = partes.join("");
        }
    }

    const numero = Number(limpo);
    return Number.isFinite(numero) ? numero : null;
}

function uniqueNumbers(valores: number[]) {
    return [...new Set(valores.map((v) => Math.round(v * 100) / 100))];
}

function extrairValoresMonetarios(texto: string) {
    const valores = [...texto.matchAll(/(?:r\s*\$|rs)\s*([0-9][0-9.\s]*(?:,\d{1,2})?)/gi)]
        .map((match) => parseNumeroBR(match[1]))
        .filter((valor): valor is number => valor !== null && valor >= 500);
    return uniqueNumbers(valores);
}

function extrairAreas(texto: string) {
    const matches = texto.matchAll(/(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:m\s*(?:2|\u00b2)|metros?\s+quadrados?)/gi);
    const areas = [...matches]
        .map((match) => parseNumeroBR(match[1]))
        .filter((valor): valor is number => valor !== null && valor >= 10 && valor <= 100000);
    return uniqueNumbers(areas);
}

function extrairTransacao(normalized: string): TransactionSignal | undefined {
    if (/\b(?:para\s+)?alugar\b|\baluguel\b|\blocacao\b|\blocar\b/.test(normalized)) return "For Rent";
    if (/\b(?:a\s+)?venda\b|\bcomprar\b|\bcompra\b/.test(normalized)) return "For Sale";
    return undefined;
}

function extrairTipoIntencao(normalized: string): PropertyIntent | undefined {
    if (/\bcasa\s+comercial\b|\bcomercial\s+casa\b/.test(normalized)) return "commercial_house";
    if (/\bgalpao\b|\bbarracao\b|\bindustrial\b/.test(normalized)) return "warehouse";
    if (/\bapartamento\b|\bapto\b|\bflat\b|\bkitnet\b|\bstudio\b/.test(normalized)) return "apartment";
    if (/\bterreno\b|\blote\b/.test(normalized)) return "land";
    if (/\bcasa\b|\bsobrado\b|\bresidencia\b/.test(normalized)) return "house";
    if (/\bsala\b|\blaje\b|\bconjunto\b|\bescritorio\b|\boffice\b/.test(normalized)) return "office";
    if (/\bcomercial\b|\bloja\b|\bsalao\b|\bbusiness\b/.test(normalized)) return "commercial";
    return undefined;
}

function extrairCidade(normalized: string) {
    return CITY_HINTS.find((cidade) => normalized.includes(cidade));
}

function extrairTokensEndereco(normalized: string) {
    const match = normalized.match(
        /\b(?:avenida|av|rua|r|rodovia|estrada|alameda|travessa)\s+([a-z0-9\s]{3,90}?)(?=\s+(?:r\s*\d|rs\s*\d|valor|preco|por|alugar|venda|comprar|em\s+(?:sorocaba|votorantim|ipero|itu|mairinque|aracoiaba|salto)|\d+\s*m)|$)/
    );
    const trecho = match?.[1] || "";
    return trecho
        .split(/\s+/)
        .filter((token) => token.length > 2 && !ADDRESS_TOKEN_STOP_WORDS.has(token))
        .slice(0, 8);
}

function extrairSinaisBusca(texto: string): SearchSignals {
    const normalized = normalizarTexto(texto);
    return {
        normalized,
        codigo: normalizarCodigo(texto),
        transacao: extrairTransacao(normalized),
        tipo: extrairTipoIntencao(normalized),
        cidade: extrairCidade(normalized),
        addressTokens: extrairTokensEndereco(normalized),
        valores: extrairValoresMonetarios(texto),
        areas: extrairAreas(texto),
        hasPortalText: /portal|juliocasas|zap|vivareal|olx|imovelweb|chavesnamao|imoveis|imovel/.test(normalized),
    };
}

function temSinaisObjetivos(sinais: SearchSignals) {
    return Boolean(
        sinais.codigo ||
        sinais.transacao ||
        sinais.tipo ||
        sinais.cidade ||
        sinais.addressTokens.length > 0 ||
        sinais.valores.length > 0 ||
        sinais.areas.length > 0
    );
}

function temSinaisFortes(sinais: SearchSignals) {
    return Boolean(
        sinais.codigo ||
        sinais.addressTokens.length >= 2 ||
        (sinais.transacao && sinais.tipo && (sinais.valores.length > 0 || sinais.areas.length > 0)) ||
        (sinais.tipo && sinais.valores.length > 0 && sinais.areas.length > 0)
    );
}

function textoComparavelImovel(imovel: any) {
    return normalizarTexto(
        `${imovel.id} ${imovel.titulo} ${imovel.tipo_imovel} ${imovel.cidade} ${imovel.bairro} ${imovel.endereco} ${imovel.empreendimento} ${imovel.preco} ${imovel.descricao}`
    ) + " " + extrairEquivalentesNumericos(imovel.endereco || "");
}

function distanciaLevenshtein(a: string, b: string) {
    const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i++) dp[i][0] = i;
    for (let j = 0; j <= b.length; j++) dp[0][j] = j;

    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const custo = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + custo
            );
        }
    }

    return dp[a.length][b.length];
}

function tokenExisteComTolerancia(tokensTexto: string[], tokenBusca: string) {
    if (tokensTexto.includes(tokenBusca)) return true;
    if (tokenBusca.length < 5) return false;
    return tokensTexto.some((tokenTexto) =>
        tokenTexto.length >= 5 &&
        Math.abs(tokenTexto.length - tokenBusca.length) <= 1 &&
        distanciaLevenshtein(tokenTexto, tokenBusca) <= 1
    );
}

function tipoCompativel(imovel: any, tipo: PropertyIntent) {
    const texto = normalizarTexto(`${imovel.tipo_imovel} ${imovel.titulo}`);
    const isLand = /\bland\b|\bterreno\b|\blote\b/.test(texto);
    const isApartment = /\bapartment\b|\bapartamento\b|\bapto\b|\bflat\b|\bkitnet\b|\bstudio\b/.test(texto);
    const isHouse = /\bhouse\b|\bcasa\b|\bsobrado\b|\bresidencia\b/.test(texto);
    const isCommercial = /\bcommercial\b|\bcomercial\b|\bbusiness\b|\bloja\b|\bsalao\b|\bedificio\b|\boffice\b|\bsala\b/.test(texto);
    const isWarehouse = /\bindustrial\b|\bgalpao\b|\bbarracao\b|\bwarehouse\b/.test(texto);

    if (tipo === "commercial_house") return isCommercial && isHouse && !isLand;
    if (tipo === "house") return isHouse && !isApartment && !isLand;
    if (tipo === "apartment") return isApartment;
    if (tipo === "land") return isLand;
    if (tipo === "warehouse") return isWarehouse;
    if (tipo === "office") return (/\boffice\b|\bsala\b|\blaje\b|\bescritorio\b|\bconjunto\b|\bcommercial\b|\bcomercial\b/.test(texto)) && !isLand;
    if (tipo === "commercial") return isCommercial && !isLand;
    return true;
}

function diferencaRelativa(a: number, b: number) {
    return Math.abs(a - b) / Math.max(a, b, 1);
}

function melhorDiferenca(alvo: number, candidatos: number[]) {
    if (candidatos.length === 0) return null;
    return Math.min(...candidatos.map((candidato) => diferencaRelativa(alvo, candidato)));
}

function avaliarCompatibilidadeObjetiva(imovel: any, sinais: SearchSignals) {
    const texto = textoComparavelImovel(imovel);
    const tokensImovel = texto.split(/\s+/).filter(Boolean);
    const evidencias: string[] = [];
    const bloqueios: string[] = [];
    let objectiveScore = 0;

    if (sinais.transacao) {
        if (imovel.tipo_transacao !== sinais.transacao) {
            bloqueios.push("transacao incompatível");
        } else {
            objectiveScore += 0.25;
            evidencias.push("Transacao bate com o print");
        }
    }

    if (sinais.tipo) {
        if (!tipoCompativel(imovel, sinais.tipo)) {
            bloqueios.push("tipo incompatível");
        } else {
            objectiveScore += 0.25;
            evidencias.push("Tipo do imovel bate com o print");
        }
    }

    if (sinais.cidade) {
        const cidadeImovel = normalizarTexto(imovel.cidade || "");
        if (cidadeImovel && cidadeImovel !== sinais.cidade) {
            bloqueios.push("cidade incompatível");
        } else if (cidadeImovel) {
            objectiveScore += 0.12;
            evidencias.push("Cidade bate com o print");
        }
    }

    if (sinais.addressTokens.length > 0) {
        const matches = sinais.addressTokens.filter((token) => tokenExisteComTolerancia(tokensImovel, token));
        const required = sinais.addressTokens.length >= 2 ? Math.ceil(sinais.addressTokens.length * 0.6) : 1;
        if (sinais.addressTokens.length >= 2 && matches.length < required) {
            bloqueios.push("endereco incompatível");
        } else if (matches.length > 0) {
            objectiveScore += Math.min(matches.length * 0.18, 0.54);
            evidencias.push(`${matches.length} termos do endereco bateram`);
        }
    }

    if (sinais.valores.length > 0) {
        const precoImovel = parseNumeroBR(String(imovel.preco || ""));
        if (precoImovel) {
            const diff = melhorDiferenca(precoImovel, sinais.valores);
            if (diff !== null && diff <= 0.05) {
                objectiveScore += 0.35;
                evidencias.push("Preco bate com o print");
            } else if (diff !== null && diff <= 0.20) {
                objectiveScore += 0.20;
                evidencias.push("Preco proximo ao print");
            } else if (diff !== null && diff > 0.35 && temSinaisFortes(sinais)) {
                bloqueios.push("preco incompatível");
            }
        }
    }

    if (sinais.areas.length > 0) {
        const areasImovel = extrairAreas(`${imovel.titulo || ""} ${imovel.descricao || ""}`);
        const diffs = sinais.areas.flatMap((areaPrint) =>
            areasImovel.map((areaImovel) => diferencaRelativa(areaPrint, areaImovel))
        );
        const melhorDiff = diffs.length > 0 ? Math.min(...diffs) : null;
        if (melhorDiff !== null && melhorDiff <= 0.08) {
            objectiveScore += 0.25;
            evidencias.push("Area bate com o print");
        } else if (melhorDiff !== null && melhorDiff <= 0.25) {
            objectiveScore += 0.12;
            evidencias.push("Area proxima ao print");
        } else if (melhorDiff !== null && melhorDiff > 0.45 && sinais.addressTokens.length > 0) {
            bloqueios.push("area incompatível");
        }
    }

    return { objectiveScore, evidencias, bloqueios };
}

async function extrairVetorImagem(imageUrl: string): Promise<number[]> {
    const { RawImage } = await getTransformers();
    const buffer = await baixarImagemBuffer(imageUrl);
    const { data, info } = await sharp(buffer)
        .rotate()
        .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    const img = new RawImage(new Uint8ClampedArray(data), info.width, info.height, info.channels);
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
                await carregarModeloTexto();
            }
            vetor = textUnchanged && cached?.vetorTexto
                ? cached.vetorTexto
                : Array.from((await extractor(textoParaVetor, { pooling: 'mean', normalize: true })).data) as number[];
            if (!imagesUnchanged && todasFotos.length > 0) {
                if (!clipModel) {
                    console.log("📥 [WORKER] Carregando modelo visual...");
                    await carregarModeloVisual();
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
            //await new Promise(resolve => setTimeout(resolve, 2000));
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
const readyPromise = sincronizarVetores().catch(err => {
    console.error("❌ [WORKER] Erro fatal na sincronização:", err);
    throw err;
});

let ocrWorker: any = null;

function formatarImovel(i:any, score?:number, evidencias:string[] = []) {
    return {
    ListingID: i.id,
    Title: i.titulo,
    Transacao: i.tipo_transacao === "For Rent" ? "Locação" : "Venda",
    PropertyType: i.tipo_imovel,
    Cidade: i.cidade,
    Bairro: i.bairro,
    Valor: i.preco,
    LinkFoto: i.imagem_url,
    Score: score !== undefined ? score.toFixed(3) : undefined,
    Evidencias: evidencias,
  };
}

function normalizarCodigo(texto: string) {
  return texto.match(/\b[LV]\s?\d{3,6}\b/i)?.[0]?.replace(/\s/g, "").toUpperCase();
}

function extrairNumerosCodigo(texto:string) {
  return texto?.replace(/\D/g, "") || "";
}

function parecePrint(textoOuUrl: string) {
  return /print|screenshot|whatsapp|portal|imovel|juliocasas|zap|vivareal|olx|imovelweb|chavesnamao/i.test(textoOuUrl);
}

async function baixarImagemBuffer(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Falha ao baixar imagem: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function imagemProvavelmentePrint(imageUrl: string) {
  try {
    const metadata = await sharp(await baixarImagemBuffer(imageUrl)).metadata();
    if (!metadata.width || !metadata.height) return false;
    return metadata.height > metadata.width && metadata.height / metadata.width >= 1.35;
  } catch {
    return false;
  }
}

async function extrairTextoOCR(imageUrl: string) {
  if (!ocrWorker) {
    ocrWorker = await createWorker("por+eng");
  }
  const buffer = await baixarImagemBuffer(imageUrl);
  const prepared = await sharp(buffer)
    .resize({ width: 1400, withoutEnlargement: true })
    .grayscale()
    .normalize()
    .png()
    .toBuffer();

  const result = await ocrWorker.recognize(prepared);
  return result.data.text || "";
}

function buscarPorCodigoLocal(codigo: string) {
  const codigoLimpo = codigo.replace(/\D/g, "");
  return vetorDeImoveis.find(
    (i) =>
      i.id?.toLowerCase() === codigo.toLowerCase() ||
      i.id?.replace(/\D/g, "") === codigoLimpo
  );
}

async function buscarPorTextoInterno(texto: string, sinais = extrairSinaisBusca(texto)) {
  if (!extractor) {
    await carregarModeloTexto();
  }

  const outputTexto = await extractor(texto, { pooling: "mean", normalize: true });
  const vetorPedido = Array.from(outputTexto.data) as number[];
  const queryNorm = sinais.normalized;
  const queryWords = queryNorm.split(/\s+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  return vetorDeImoveis
    .map((imovel) => {
      const semanticScore = calcularSimilaridade(vetorPedido, imovel.vetorTexto);
      const textoComparar = textoComparavelImovel(imovel);
      const objetivo = avaliarCompatibilidadeObjetiva(imovel, sinais);

      if (objetivo.bloqueios.length > 0) {
        return { ...imovel, score: -Infinity, objectiveScore: 0, evidencias: objetivo.evidencias };
      }

      const matchCount = queryWords.filter((w) => textoComparar.includes(w)).length;
      const keywordBoost = Math.min(matchCount * 0.08, 0.40);

      return {
        ...imovel,
        score: semanticScore + keywordBoost + objetivo.objectiveScore,
        objectiveScore: objetivo.objectiveScore,
        evidencias: [
          ...objetivo.evidencias,
          ...(matchCount > 0 ? [`${matchCount} termos do print bateram com a base`] : []),
        ],
      };
    })
    .filter((imovel) => Number.isFinite(imovel.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

async function buscarVisualComConfianca(fotoUrl: string) {
  if (!clipModel) {
    await carregarModeloVisual();
  }

  const vetorCliente = await extrairVetorImagem(fotoUrl);

  const ranked = vetorDeImoveis
    .filter((i) => i.vetoresImagens?.length > 0)
    .map((i) => ({
      ...i,
      score: Math.max(...i.vetoresImagens.map((v: number[]) => calcularSimilaridade(vetorCliente, v))),
    }))
    .sort((a, b) => b.score - a.score);

  const top = ranked[0];
  const second = ranked[1];
  const margin = top && second ? top.score - second.score : 1;

  if (top && top.score >= EXACT_THRESHOLD && margin >= EXACT_MARGIN) {
    return {
      matchType: "exact",
      confidence: "high",
      source: "visual_clip",
      items: [formatarImovel(top, top.score, ["Foto muito parecida com imagem do catálogo"])],
    };
  }

  return {
    matchType: "candidates",
    confidence: top?.score >= CANDIDATE_THRESHOLD ? "medium" : "low",
    source: "visual_clip",
    items: ranked
      .filter((i) => i.score >= CANDIDATE_THRESHOLD)
      .slice(0, 3)
      .map((i) => formatarImovel(i, i.score, ["Semelhança visual com o catálogo"])),
  };
}
  
parentPort?.on('message', async (message) => {
    try {
        await readyPromise;
    } catch (error) {
        parentPort?.postMessage({
            requestId: message.requestId,
            status: "CONCLUIDO",
            data: {
                matchType: "none",
                confidence: "low",
                source: "catalog_error",
                items: [],
            },
        });
        return;
    }

    if (message.command === 'BUSCAR_CODIGO') {
        const codigoLimpo = message.codigo.replace(/\D/g, '');
        const encontrados = vetorDeImoveis.filter(i =>
            i.id.toLowerCase() === message.codigo.toLowerCase() || i.id.replace(/\D/g, '') === codigoLimpo
        ).map(i => ({ ListingID: i.id, Title: i.titulo, PropertyType: i.tipo_imovel, Bairro: i.bairro, Valor: i.preco, Transacao: i.tipo_transacao === 'For Rent' ? 'Locação' : 'Venda', Quartos: i.quartos }));
        parentPort?.postMessage({ requestId: message.requestId, status: 'CONCLUIDO', data: encontrados.length > 0 ? encontrados : null });
    }

    if (message.command === "BUSCAR_FOTO") {
  try {
    let ocrText = "";
    const visualResult = await buscarVisualComConfianca(message.foto_url);
    const deveTentarOCR =
      visualResult.confidence !== "high" ||
      parecePrint(message.foto_url) ||
      await imagemProvavelmentePrint(message.foto_url);
    let sinaisOCR: SearchSignals | null = null;

    if (deveTentarOCR) {
      try {
        ocrText = await extrairTextoOCR(message.foto_url);
        sinaisOCR = extrairSinaisBusca(ocrText);
      } catch (ocrError) {
        console.warn("⚠️ [WORKER] OCR falhou, mantendo resultado visual:", ocrError);
      }
      const codigoOCR = sinaisOCR?.codigo || normalizarCodigo(ocrText);

      if (codigoOCR) {
        const imovel = buscarPorCodigoLocal(codigoOCR);
        if (imovel) {
          parentPort?.postMessage({
            requestId: message.requestId,
            status: "CONCLUIDO",
            data: {
              matchType: "exact",
              confidence: "high",
              source: "ocr_code",
              items: [formatarImovel(imovel, 1, [`Código encontrado no print: ${extrairNumerosCodigo(codigoOCR)}`])],
            },
          });
          return;
        }
      }
    }

    if (ocrText && sinaisOCR && temSinaisObjetivos(sinaisOCR)) {
      const textCandidates = await buscarPorTextoInterno(ocrText, sinaisOCR);
      const candidatosRelevantes = textCandidates.filter(
        (i) => i.score >= OCR_TEXT_CANDIDATE_THRESHOLD || i.objectiveScore >= 0.45
      );
      const melhores = candidatosRelevantes.slice(0, 3).map((i) =>
        formatarImovel(i, i.score, i.evidencias || ["Texto do print parecido com a base"])
      );
      const top = candidatosRelevantes[0];
      const second = candidatosRelevantes[1];
      const margin = top && second ? top.score - second.score : 1;
      const exactByOcr =
        Boolean(top) &&
        temSinaisFortes(sinaisOCR) &&
        top.objectiveScore >= 0.62 &&
        (margin >= 0.18 || top.objectiveScore >= 0.90);

      if (melhores.length > 0 || temSinaisFortes(sinaisOCR)) {
        parentPort?.postMessage({
          requestId: message.requestId,
          status: "CONCLUIDO",
          data: {
            matchType: melhores.length > 0 ? (exactByOcr ? "exact" : "candidates") : "none",
            confidence: melhores.length > 0 ? (exactByOcr ? "high" : "medium") : "low",
            source: "ocr_objective",
            items: exactByOcr ? melhores.slice(0, 1) : melhores,
          },
        });
        return;
      }
    }

    parentPort?.postMessage({
      requestId: message.requestId,
      status: "CONCLUIDO",
      data: visualResult,
    });
  } catch (error) {
    console.error("❌ Erro na busca por foto:", error);
    parentPort?.postMessage({
      requestId: message.requestId,
      status: "CONCLUIDO",
      data: {
        matchType: "none",
        confidence: "low",
        source: "error",
        items: [],
      },
    });
  }
}

    if (message.command === 'BUSCAR_SEMANTICA') {
        const pedido = message.text;
        if (!extractor) {
            await carregarModeloTexto();
        }
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
        parentPort?.postMessage({ requestId: message.requestId, status: 'CONCLUIDO', data: resultado });
    }
});
