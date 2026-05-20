import { tool } from "@langchain/core/tools";
import { z } from 'zod';
import Papa from 'papaparse';
import { pipeline, RawImage, CLIPModel, AutoProcessor, AutoTokenizer } from "@xenova/transformers"
import fs from 'fs';
import path from 'path';


const searchSchema = z.object({
    pedido_livre: z.string().optional().describe("A frase do cliente com o que ele deseja (opcional se passar foto)"),
    codigo: z.string().optional().describe("Código numérico (ListingID), APENAS se o cliente passar um"),
    foto_url: z.string().optional().describe("URL da foto enviada pelo cliente para fazermos busca visual"),
})

let extractor: any = null;
let clipModel: any = null;
let clipProcessor: any = null;
let clipTokenizer: any = null;
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

function normalizarTexto(txt: string): string {
    return txt
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // remove accents
        .replace(/[^a-z0-9\s]/g, " ");   // keep only letters, numbers and spaces
}

function extrairEquivalentesNumericos(texto: string): string {
    const porExtenso: { [key: string]: string } = {
        "um": "1", "dois": "2", "tres": "3", "quatro": "4", "cinco": "5", "seis": "6", "sete": "7", "oito": "8", "nove": "9",
        "dez": "10", "onze": "11", "doze": "12", "treze": "13", "quatorze": "14", "quinze": "15", "dezesseis": "16", "dezessete": "17", "dezoito": "18", "dezenove": "19",
        "vinte": "20", "trinta": "30", "quarenta": "40", "cinquenta": "50", "sessenta": "60", "setenta": "70", "oitenta": "80", "noventa": "90"
    };

    let textoNormalizado = normalizarTexto(texto);
    let equivalentes: string[] = [];

    // 1. Procura por números escritos por extenso compostos (ex: "vinte e oito" -> 28)
    const dezenas = ["vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
    const unidades = ["um", "dois", "tres", "quatro", "cinco", "seis", "sete", "oito", "nove"];

    for (const d of dezenas) {
        for (const u of unidades) {
            const composto = `${d} e ${u}`;
            if (textoNormalizado.includes(composto)) {
                const valD = parseInt(porExtenso[d]);
                const valU = parseInt(porExtenso[u]);
                equivalentes.push((valD + valU).toString());
            }
        }
    }

    // 2. Procura por números simples por extenso (ex: "nove" -> 9, "quinze" -> 15)
    for (const [extenso, digito] of Object.entries(porExtenso)) {
        const regex = new RegExp(`\\b${extenso}\\b`, "g");
        if (regex.test(textoNormalizado)) {
            equivalentes.push(digito);
        }
    }

    // 3. Procura por dígitos numéricos e adiciona a versão por extenso (ex: 28 -> "vinte e oito")
    const digitosEncontrados = textoNormalizado.match(/\b\d+\b/g);
    if (digitosEncontrados) {
        const unidadesExt = ["", "um", "dois", "tres", "quatro", "cinco", "seis", "sete", "oito", "nove"];
        const dezenasExt = ["", "dez", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
        const especiaisExt = ["dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];

        for (const digitoStr of digitosEncontrados) {
            const num = parseInt(digitoStr);
            if (num > 0 && num < 100) {
                let extenso = "";
                if (num < 10) extenso = unidadesExt[num];
                else if (num < 20) extenso = especiaisExt[num - 10];
                else {
                    const d = Math.floor(num / 10);
                    const u = num % 10;
                    extenso = u === 0 ? dezenasExt[d] : `${dezenasExt[d]} e ${unidadesExt[u]}`;
                }
                equivalentes.push(extenso);
            }
        }
    }

    return equivalentes.join(" ");
}

const STOP_WORDS = new Set([
    "vi", "um", "para", "alugar", "na", "rua", "de", "perto", "da", "no", "esta", "disponivel",
    "o", "a", "em", "com", "que", "uma", "uns", "do", "dos", "das", "sobre", "como", "mais", "tem",
    "gostaria", "ver", "casa", "apartamento", "terreno", "apto", "lote", "chacara", "sitio", "sobrado"
]);

async function extrairVetorImagem(imageUrl: string): Promise<number[]> {
    const img = await RawImage.read(imageUrl);
    const imageInputs = await clipProcessor(img);
    const textInputs = await clipTokenizer([""]);
    const output = await clipModel({ ...textInputs, pixel_values: imageInputs.pixel_values });
    return Array.from(output.image_embeds.data) as number[];
}

const CACHE_PATH = path.join(process.cwd(), 'data', 'vetores-cache.json');

async function sincronizarVetores() {
    if (vetorDeImoveis.length > 0 || isCarregando) return;
    isCarregando = true;

    let cache: { [key: string]: { vetorTexto: number[], vetoresImagens: number[][], textoParaVetor: string, imagensHash: string } } = {};
    try {
        if (fs.existsSync(CACHE_PATH)) {
            const cacheContent = fs.readFileSync(CACHE_PATH, 'utf-8');
            cache = JSON.parse(cacheContent);
            console.log("📂 [SISTEMA] Cache de vetores locais carregado com sucesso!");
        }
    } catch (e) {
        console.warn("⚠️ Não foi possível ler o arquivo de cache de vetores:", e);
    }

    console.log("📥 [SISTEMA] Lendo CSV de imóveis...");
    const response = await fetch("https://tijci.github.io/auto-xml-ksi-format/docs/imoveis.csv");
    const csvText = await response.text();
    const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });

    const imoveisFiltrados = parsed.data.filter((i: any) => i.tipo_transacao === "For Rent" || i.tipo_transacao === "For Sale") as any[];
    console.log(`📥 [SISTEMA] Processando ${imoveisFiltrados.length} imóveis de Locação...`);

    let cacheAlterado = false;

    for (const imovel of imoveisFiltrados) {
        const idOriginal = imovel.id || "";
        const idLimpo = idOriginal.replace(/\D/g, '');

        const descResumida = imovel.descricao ? imovel.descricao.substring(0, 800) : "";

        const ruaEndereco = imovel.endereco || "";
        const numEndereco = imovel.numero ? ` nº ${imovel.numero}` : "";
        const compEndereco = imovel.complemento ? ` apto/sala ${imovel.complemento}` : "";
        const condominioEmpreendimento = imovel.empreendimento ? ` Condomínio/Edifício: ${imovel.empreendimento}.` : "";
        const transacaoTexto = imovel.tipo_transacao === "For Rent" ? "Aluguel / Locação" : "Venda / Compra";

        const textoParaVetor = `Imóvel: ${imovel.tipo_imovel}. Cidade: ${imovel.cidade}. Operação: ${transacaoTexto}. Bairro: ${imovel.bairro}. Endereço: ${ruaEndereco}${numEndereco}${compEndereco}.${condominioEmpreendimento} Quartos: ${imovel.quartos}. Título: ${imovel.titulo}. Descrição: ${descResumida}`;

        const fotosAdicionaisList = imovel.fotos_adicionais ? imovel.fotos_adicionais.split("|") : [];
        const todasFotos = [imovel.imagem_url, ...fotosAdicionaisList].filter(Boolean).slice(0, 6); // Limite de 6 fotos por imóvel
        const imagensHash = todasFotos.join("|");

        let vetor: number[] = [];
        let vectorImages: number[][] = [];

        const cached = cache[idOriginal] || cache[idLimpo];
        const textUnchanged = cached && cached.textoParaVetor === textoParaVetor;
        const imagesUnchanged = cached && cached.imagensHash === imagensHash;

        if (textUnchanged && imagesUnchanged && cached.vetorTexto && cached.vetoresImagens && cached.vetoresImagens.length > 0) {
            vetor = cached.vetorTexto;
            vectorImages = cached.vetoresImagens;
        } else {
            cacheAlterado = true;
            console.log(`⚡ [SISTEMA] Atualizando embeddings do imóvel ${idOriginal}...`);

            // Lazy load do extrator de texto
            if (!extractor) {
                console.log("📥 [SISTEMA] Acordando IA Semântica (modelo paraphrase-multilingual)...");
                extractor = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');
            }

            // Vetoriza Texto
            if (textUnchanged && cached && cached.vetorTexto) {
                vetor = cached.vetorTexto;
            } else {
                const output = await extractor(textoParaVetor, { pooling: 'mean', normalize: true });
                vetor = Array.from(output.data) as number[];
            }

            // Vetoriza Imagens
            if (imagesUnchanged && cached && cached.vetoresImagens && cached.vetoresImagens.length > 0) {
                vectorImages = cached.vetoresImagens;
            } else {
                if (todasFotos.length > 0) {
                    if (!clipModel) {
                        console.log("📥 [SISTEMA] Acordando IA Visual (modelo clip-vit-large-patch14)...");
                        clipModel = await CLIPModel.from_pretrained('Xenova/clip-vit-large-patch14');
                        clipProcessor = await AutoProcessor.from_pretrained('Xenova/clip-vit-large-patch14');
                        clipTokenizer = await AutoTokenizer.from_pretrained('Xenova/clip-vit-large-patch14');
                    }
                    for (const url of todasFotos) {
                        try {
                            const vecImg = await extrairVetorImagem(url);
                            vectorImages.push(vecImg);
                        } catch (err) {
                            console.warn(`⚠️ Não foi possível carregar a imagem ${url} do imóvel ${idLimpo}:`, err);
                        }
                    }
                }
            }

            // Atualiza cache
            cache[idOriginal] = {
                vetorTexto: vetor,
                vetoresImagens: vectorImages,
                textoParaVetor,
                imagensHash
            };
        }

        vetorDeImoveis.push({
            id: idOriginal,
            tipo_transacao: imovel.tipo_transacao,
            titulo: imovel.titulo,
            tipo_imovel: imovel.tipo_imovel,
            bairro: imovel.bairro,
            preco: imovel.preco,
            quartos: imovel.quartos,
            imagem_url: imovel.imagem_url,
            fotos_adicionais: imovel.fotos_adicionais || "",
            endereco: imovel.endereco,
            numero: imovel.numero,
            complemento: imovel.complemento,
            cidade: imovel.cidade,
            empreendimento: imovel.empreendimento,
            descricao: imovel.descricao,
            vetorTexto: vetor,
            vetoresImagens: vectorImages
        });
    }

    if (cacheAlterado) {
        try {
            fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf-8');
            console.log("💾 [SISTEMA] Cache de vetores atualizado e salvo em disco com sucesso!");
        } catch (e) {
            console.warn("⚠️ Não foi possível gravar o arquivo de cache de vetores:", e);
        }
    }
    console.log(`✅ [SISTEMA] Banco Vetorial pronto! ${vetorDeImoveis.length} imóveis na memória RAM.`);

}



export const searchPropertiesTool = tool(
    async ({ pedido_livre, foto_url, codigo }) => {
        console.log(`\n🔎 [SEMÂNTICA]: Ana pediu busca livre: "${pedido_livre}" | Cod: ${codigo}`);
        try {
            await sincronizarVetores();
            if (codigo) {
                const codigoLimpo = codigo.replace(/\D/g, '');
                const encontrados = vetorDeImoveis.filter(i => {
                    const idOriginal = i.id.toLowerCase();
                    const paramLower = codigo.toLowerCase();
                    return idOriginal === paramLower || idOriginal.replace(/\D/g, '') === codigoLimpo;
                });
                if (encontrados.length > 0) {
                    return JSON.stringify(encontrados.map(exato => ({
                        ListingID: exato.id,
                        Title: exato.titulo,
                        PropertyType: exato.tipo_imovel,
                        Bairro: exato.bairro,
                        Valor: exato.preco,
                        Transacao: exato.tipo_transacao === 'For Rent' ? 'Locação' : 'Venda',
                        Quartos: exato.quartos
                    })));
                }
                return "Nenhum imóvel encontrado com esse código.";
            }
            let imoveisComScore = [];
            let limiarAplicado = 0.25; // Limiar padrão para busca textual

            if (foto_url) {
                console.log("🎨 Rodando comparação foto a foto...");
                if (!clipModel) {
                    console.log("📥 [SISTEMA] Acordando IA Visual (modelo clip-vit-large-patch14)...");
                    clipModel = await CLIPModel.from_pretrained('Xenova/clip-vit-large-patch14');
                    clipProcessor = await AutoProcessor.from_pretrained('Xenova/clip-vit-large-patch14');
                    clipTokenizer = await AutoTokenizer.from_pretrained('Xenova/clip-vit-large-patch14');
                }
                const vetorCliente = await extrairVetorImagem(foto_url);
                imoveisComScore = vetorDeImoveis
                    .filter(imovel => imovel.vetoresImagens && imovel.vetoresImagens.length > 0)
                    .map(imovel => {
                        let maxScore = 0;
                        for (const vetorImovel of imovel.vetoresImagens) {
                            const score = calcularSimilaridade(vetorCliente, vetorImovel);
                            if (score > maxScore) {
                                maxScore = score;
                            }
                        }
                        return { ...imovel, score: maxScore };
                    });
                limiarAplicado = 0.60; // 📌 Limiar de corte para fotos (exige 60% de semelhança visual)
            } else if (pedido_livre) {
                console.log("📝 Rodando busca semântica híbrida por texto...");
                const outputTexto = await extractor(pedido_livre, { pooling: 'mean', normalize: true });
                const vetorPedido = Array.from(outputTexto.data) as number[];

                // Normalizações e extração de palavras-chave da busca
                const queryNorm = normalizarTexto(pedido_livre);
                const queryWords = queryNorm.split(/\s+/).filter(w => w.length > 1 && !STOP_WORDS.has(w));

                const queryIsApartment = queryNorm.includes("apartamento") || queryNorm.includes("apto");
                const queryIsHouse = queryNorm.includes("casa");
                const queryIsTerrain = queryNorm.includes("terreno");
                const queryIsRent = queryNorm.includes("alug") || queryNorm.includes("locac") || queryNorm.includes("alugar") || queryNorm.includes("locar");
                const queryIsSale = queryNorm.includes("compr") || queryNorm.includes("vend") || queryNorm.includes("comprar") || queryNorm.includes("venda") || queryNorm.includes("adquirir");

                imoveisComScore = vetorDeImoveis.map(imovel => {
                    const semanticScore = calcularSimilaridade(vetorPedido, imovel.vetorTexto);

                    // 1. Keyword Boost
                    let matchCount = 0;
                    const ruaEndereco = imovel.endereco || "";
                    const numEndereco = imovel.numero ? ` nº ${imovel.numero}` : "";
                    const compEndereco = imovel.complemento ? ` apto/sala ${imovel.complemento}` : "";
                    const condominioEmpreendimento = imovel.empreendimento ? ` ${imovel.empreendimento}` : "";
                    const equivalentesEndereco = extrairEquivalentesNumericos(ruaEndereco);
                    const textoParaComparar = normalizarTexto(`${imovel.tipo_imovel} ${imovel.cidade} ${imovel.bairro} ${ruaEndereco} ${numEndereco} ${compEndereco} ${condominioEmpreendimento} ${imovel.titulo} ${imovel.descricao}`) + " " + equivalentesEndereco;

                    for (const word of queryWords) {
                        let matched = textoParaComparar.includes(word);
                        // Mapeamento numérico universal inteligente (ex: "9" <-> "nove")
                        if (!matched && /^\d+$/.test(word)) {
                            const extensoDaBusca = extrairEquivalentesNumericos(word);
                            if (extensoDaBusca && textoParaComparar.includes(extensoDaBusca)) {
                                matched = true;
                            }
                        }
                        if (matched) {
                            matchCount++;
                        }
                    }

                    // Cada palavra batida dá 15% de boost, até um limite de 60%
                    const keywordBoost = Math.min(matchCount * 0.15, 0.60);

                    // 2. Restrição Rígida de Categoria (Evita misturar Terrenos com Apartamentos!)
                    const propertyTypeNorm = normalizarTexto(imovel.tipo_imovel || "");
                    let typeMultiplier = 1.0;

                    if (queryIsApartment && !propertyTypeNorm.includes("apartment")) {
                        typeMultiplier = 0.1; // penaliza pesadamente se o cliente quer apartamento e o imóvel não é um
                    }
                    if (queryIsHouse && !propertyTypeNorm.includes("house") && !propertyTypeNorm.includes("casa")) {
                        typeMultiplier = 0.1; // penaliza pesadamente se o cliente quer casa e o imóvel não é uma
                    }
                    if (queryIsTerrain && !propertyTypeNorm.includes("land") && !propertyTypeNorm.includes("terreno")) {
                        typeMultiplier = 0.1; // penaliza pesadamente se o cliente quer terreno e o imóvel não é um
                    }
                    let transactionMultiplier = 1.0;
                    if (queryIsRent && imovel.tipo_transacao !== "For Rent") {
                        transactionMultiplier = 0.1;
                    }
                    if (queryIsSale && imovel.tipo_transacao !== "For Sale") {
                        transactionMultiplier = 0.1;
                    }

                    const finalScore = (semanticScore + keywordBoost) * typeMultiplier * transactionMultiplier;
                    return { ...imovel, score: finalScore };
                });

                limiarAplicado = 0.25; // 📌 Limiar de corte para texto semântico
            } else {
                return "Por favor, envie uma foto ou diga o que está procurando.";
            }

            // Ordena os imóveis por relevância decrescente
            imoveisComScore.sort((a, b) => b.score - a.score);

            // Exibe no console o top 3 encontrado antes do corte (para fins de desenvolvimento/ajustes)
            console.log("\n📊 [DESENVOLVIMENTO] Melhores pontuações encontradas antes do filtro:");
            imoveisComScore.slice(0, 3).forEach((imovel, index) => {
                console.log(`   └─ #${index + 1} [ID: ${imovel.id}] - Relevância: ${(imovel.score * 100).toFixed(1)}% | Título: ${imovel.titulo} | Bairro: ${imovel.bairro}`);
            });
            console.log(`   📌 Limiar mínimo exigido: ${(limiarAplicado * 100).toFixed(0)}%\n`);

            // Filtra os imóveis que atingiram a pontuação mínima exigida
            const imoveisFiltrados = imoveisComScore.filter(i => i.score >= limiarAplicado);

            if (imoveisFiltrados.length === 0) {
                return "Nenhum imóvel visualmente ou textualmente compatível encontrado no catálogo.";
            }

            // Retorna apenas os que passaram na pontuação mínima (máximo de 3)
            const top3 = imoveisFiltrados.slice(0, 3).map(i => ({
                ListingID: i.id,
                Title: i.titulo,
                Transacao: i.tipo_transacao === 'For Rent' ? 'Locação' : 'Venda',
                Bairro: i.bairro,
                Valor: i.preco,
                LinkFoto: i.imagem_url,
                SemelhancaVisual: `${(i.score * 100).toFixed(1)}%`
            }));

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