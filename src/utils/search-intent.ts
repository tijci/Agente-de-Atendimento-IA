/**
 * Detecta se a mensagem do cliente já traz critérios mínimos para busca na base.
 */
import type { BaseMessage } from '@langchain/core/messages';

const TRANSACTION_PATTERN =
    /\b(alugar|aluguel|loca[cç][aã]o|locar|comprar|compra|venda|vender)\b/i;

const PROPERTY_TYPE_PATTERN =
    /\b(apartamento|apto|casa|sobrado|sala|comercial|galp[aã]o|terreno|kitnet|loft|cobertura|flat|studio|st[uú]dio)\b/i;

const REGION_PATTERN = /\b(no|na|em)\s+[\p{L}0-9][\p{L}0-9\s\-]{2,}/iu;

export function hasMinimumSearchCriteria(text: string): boolean {
    const normalized = text.trim();
    if (normalized.length < 12) return false;
    return (
        TRANSACTION_PATTERN.test(normalized) &&
        PROPERTY_TYPE_PATTERN.test(normalized) &&
        REGION_PATTERN.test(normalized)
    );
}

export function findLastHumanContent(messages: BaseMessage[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg._getType() === 'human') {
            return String(msg.content ?? '');
        }
    }
    return '';
}

/** Já existe resultado de buscar_imoveis após a última mensagem humana neste turno. */
export function hasToolResultAfterLastHuman(messages: BaseMessage[]): boolean {
    let lastHumanIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]._getType() === 'human') {
            lastHumanIdx = i;
            break;
        }
    }
    if (lastHumanIdx < 0) return false;

    for (let i = lastHumanIdx + 1; i < messages.length; i++) {
        if (messages[i]._getType() === 'tool') return true;
    }
    return false;
}

export function shouldForcePropertySearch(messages: BaseMessage[]): boolean {
    if (hasToolResultAfterLastHuman(messages)) return false;
    const humanText = findLastHumanContent(messages);
    return hasMinimumSearchCriteria(humanText);
}
