/**
 * Limpeza de texto antes do envio ao WhatsApp.
 */

const INTERIM_PHRASES =
    /\b(um momento|aguarde|aguarda|já volto|ja volto|vou buscar|vou verificar|estou buscando|estou verificando)\b/gi;

/** Remove frases de espera e markdown de imagem (![...](url)). */
export function sanitizeOutboundText(text: string): string {
    let out = text.replace(/!\[[^\]]*\]\([^)]+\)/g, '');
    out = out.replace(INTERIM_PHRASES, '');
    out = out.replace(/\n{3,}/g, '\n\n').trim();
    return out;
}
