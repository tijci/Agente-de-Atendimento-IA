/**
 * Scraping de portais imobiliários com fallback Puppeteer para portais com anti-bot.
 *
 * ESTRATÉGIA EM CASCATA:
 *   1. fetch() com headers realistas          → rápido, funciona em portais simples
 *   2. Puppeteer headless (browser singleton) → fallback para portais com Cloudflare/WAF
 *   3. Extrai: código interno, título, texto  → passa para busca vetorial
 *
 * IMPORTANTE: este módulo roda na main thread (não no worker).
 * O Puppeteer não funciona de forma confiável dentro de worker_threads.
 *
 * @module utils/portal-scraper
 */

import puppeteer, { Browser } from 'puppeteer';
import { logger } from './logger';

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface PortalScrapedData {
    /** Código interno da imobiliária encontrado na página (ex: L193, V7052, 193). */
    codigo: string | null;
    /** Título do imóvel extraído da página. */
    titulo: string | null;
    /** Texto limpo da página, até 2000 chars, para fallback semântico. */
    textoRelevante: string;
}

// ─── Portais suportados ───────────────────────────────────────────────────────

const PORTAL_DOMAINS = [
    'zapimoveis.com.br',
    'vivareal.com.br',
    'imovelweb.com.br',
    'wimoveis.com.br',
    'olx.com.br',
    'chavesnamao.com.br',
    'juliocasas.com.br',
];

// ─── Padrões de extração do código interno ───────────────────────────────────
// Cobre variações reais encontradas nos portais:
//   "Código: L193"  |  "Cód.: V7052"  |  "Ref.: 193"  |  "código do imóvel L193"

const CODIGO_PATTERNS: RegExp[] = [
    /c[oó]d(?:igo)?(?:\s+do\s+im[oó]vel)?\s*[:\.\-]?\s*([LV]?\s?\d{3,6})\b/i,
    /ref(?:er[eê]ncia)?\s*[:\.\-]?\s*([LV]?\s?\d{3,6})\b/i,
    /\bref\s*[:\.\-]\s*([LV]?\s?\d{3,6})\b/i,
];

// ─── Headers realistas (bypass de bloqueios simples) ─────────────────────────

const FETCH_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
};

// ─── Singleton do Puppeteer ───────────────────────────────────────────────────
// Reutiliza o browser entre requisições para não pagar o custo de inicialização
// a cada link enviado pelo cliente.

let sharedBrowser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
    if (sharedBrowser && sharedBrowser.connected) return sharedBrowser;

    logger.info('🚀 [PORTAL-SCRAPER] Iniciando browser Puppeteer singleton...');
    sharedBrowser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-gpu',
            '--disable-dev-shm-usage',       // evita crash em ambientes com pouca memória
            '--disable-blink-features=AutomationControlled', // esconde flag de automação
        ],
    });

    // Se o browser morrer, reseta o singleton
    sharedBrowser.on('disconnected', () => {
        logger.warn('⚠️ [PORTAL-SCRAPER] Browser desconectado; será recriado na próxima requisição');
        sharedBrowser = null;
    });

    return sharedBrowser;
}

// ─── Extração de dados do HTML ────────────────────────────────────────────────

function htmlToText(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#\d+;/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function extractCodigo(text: string): string | null {
    for (const pattern of CODIGO_PATTERNS) {
        const match = text.match(pattern);
        if (match?.[1]) return match[1].replace(/\s/g, '').toUpperCase();
    }
    return null;
}

function extractTitulo(html: string): string | null {
    // og:title é o mais limpo (sem sufixo de site)
    const og =
        html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ??
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    if (og?.[1]) return og[1].trim();

    const title = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (title?.[1]) return title[1].trim();

    const h1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (h1?.[1]) return h1[1].trim();

    return null;
}

function parseHtml(html: string): PortalScrapedData {
    const texto = htmlToText(html);
    return {
        codigo: extractCodigo(texto),
        titulo: extractTitulo(html),
        textoRelevante: texto.slice(0, 2000),
    };
}

// ─── Estratégia 1: fetch() ────────────────────────────────────────────────────

async function fetchSimples(url: string): Promise<string | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
        const response = await fetch(url, { signal: controller.signal, headers: FETCH_HEADERS });
        if (!response.ok) {
            logger.warn({ status: response.status, url }, '⚠️ [PORTAL-SCRAPER] fetch() bloqueado');
            return null; // sinaliza para tentar Puppeteer
        }
        return await response.text();
    } catch (err: any) {
        if (err?.name !== 'AbortError') logger.warn({ err: err?.message }, '⚠️ [PORTAL-SCRAPER] fetch() falhou');
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

// ─── Estratégia 2: Puppeteer ──────────────────────────────────────────────────

async function fetchComPuppeteer(url: string): Promise<string | null> {
    logger.info({ url }, '🤖 [PORTAL-SCRAPER] Ativando Puppeteer para burlar anti-bot...');
    let page;
    try {
        const browser = await getBrowser();
        page = await browser.newPage();

        // Mascara que é automação
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });

        await page.setUserAgent(FETCH_HEADERS['User-Agent']);
        await page.setExtraHTTPHeaders({ 'Accept-Language': FETCH_HEADERS['Accept-Language'] });

        // domcontentloaded é mais rápido que networkidle2; suficiente para o HTML principal
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

        // Pausa mínima para scripts de hidratação do Next.js/React renderizarem
        await new Promise((r) => setTimeout(r, 1500));

        const html = await page.content();
        logger.info({ url }, '✅ [PORTAL-SCRAPER] Puppeteer obteve o HTML');
        return html;
    } catch (err: any) {
        logger.error({ err: err?.message, url }, '❌ [PORTAL-SCRAPER] Puppeteer falhou');
        return null;
    } finally {
        await page?.close().catch(() => {}); // libera a aba mesmo em erro
    }
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Detecta URL de portal imobiliário no texto do cliente.
 */
export function extractPortalUrl(text: string): string | null {
    const match = text.match(/https?:\/\/[^\s"'<>]+/i);
    if (!match) return null;
    const url = match[0].replace(/[.,;!?)]+$/, '');
    return PORTAL_DOMAINS.some((d) => url.includes(d)) ? url : null;
}

/**
 * Scraping com cascata fetch → Puppeteer.
 * Retorna código interno, título e texto para busca semântica.
 */
export async function scrapePortalPage(url: string): Promise<PortalScrapedData> {
    logger.info({ url }, '🌐 [PORTAL-SCRAPER] Iniciando scraping...');

    // Tentativa 1: fetch simples (rápido, zero overhead)
    let html = await fetchSimples(url);

    // Tentativa 2: Puppeteer se fetch bloqueou (403, CAPTCHA etc.)
    if (!html) {
        html = await fetchComPuppeteer(url);
    }

    if (!html) {
        logger.warn({ url }, '❌ [PORTAL-SCRAPER] Não foi possível obter HTML por nenhuma estratégia');
        return { codigo: null, titulo: null, textoRelevante: '' };
    }

    const result = parseHtml(html);
    logger.info(
        { codigo: result.codigo ?? 'nenhum', titulo: result.titulo?.slice(0, 60) ?? 'nenhum' },
        '📦 [PORTAL-SCRAPER] Extração concluída'
    );
    return result;
}