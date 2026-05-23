/**
 * Parse de respostas com marcadores semânticos e agrupamento para envio humanizado.
 * @module utils/message-splitter
 */
import { env } from '../config/env';

const MARKER_PATTERN = /<<<(INTRO|MAIN|SECONDARY|CTA)>>>/gi;
const BLOCK_ORDER = ['INTRO', 'MAIN', 'SECONDARY', 'CTA'] as const;

export type SemanticBlockKey = (typeof BLOCK_ORDER)[number];

export type SemanticBlocks = Partial<Record<SemanticBlockKey, string>>;

function randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Divide texto sem marcadores em parágrafos (linha em branco) ou linhas curtas.
 */
export function splitIntoParagraphs(text: string): string[] {
    const trimmed = text.trim();
    if (!trimmed) return [];

    const byBlankLine = trimmed.split(/\n\s*\n+/).map((s) => s.trim()).filter(Boolean);
    if (byBlankLine.length > 1) return byBlankLine;

    const lines = trimmed.split(/\n/).map((s) => s.trim()).filter(Boolean);
    if (lines.length > 1 && lines.every((line) => line.length <= 400)) {
        return lines;
    }

    return [trimmed];
}

/**
 * Extrai blocos entre marcadores <<<INTRO>>> etc.
 * Sem marcadores: um bloco por parágrafo/linha.
 */
export function parseMarkedResponse(text: string): string[] {
    const trimmed = text.trim();
    if (!trimmed) return [];

    const matches = [...trimmed.matchAll(MARKER_PATTERN)];
    if (matches.length === 0) {
        return splitIntoParagraphs(trimmed);
    }

    const blocks: SemanticBlocks = {};

    for (let i = 0; i < matches.length; i++) {
        const key = matches[i][1].toUpperCase() as SemanticBlockKey;
        const contentStart = (matches[i].index ?? 0) + matches[i][0].length;
        const contentEnd = i + 1 < matches.length ? (matches[i + 1].index ?? trimmed.length) : trimmed.length;
        const content = trimmed.slice(contentStart, contentEnd).trim();
        if (content) {
            blocks[key] = blocks[key] ? `${blocks[key]}\n\n${content}` : content;
        }
    }

    const ordered = BLOCK_ORDER.flatMap((k) => {
        const block = blocks[k]?.trim();
        if (!block) return [];
        return splitIntoParagraphs(block);
    });

    return ordered.length > 0 ? ordered : splitIntoParagraphs(trimmed);
}

/**
 * Mescla blocos adjacentes aleatoriamente até restarem k grupos (1 <= k <= blocks.length).
 */
export function randomPartition(blocks: string[]): string[] {
    const nonEmpty = blocks.map((b) => b.trim()).filter(Boolean);
    if (nonEmpty.length <= 1) return nonEmpty;

    let groups: string[][] = nonEmpty.map((b) => [b]);
    const target = randomInt(1, groups.length);

    while (groups.length > target) {
        const i = randomInt(0, groups.length - 2);
        groups[i] = [...groups[i], ...groups[i + 1]];
        groups.splice(i + 1, 1);
    }

    return groups.map((g) => g.join('\n\n').trim()).filter(Boolean);
}

/**
 * Parse → mensagens para envio (1 bolha por bloco/parágrafo, ou merge aleatório se configurado).
 */
export function prepareOutboundMessages(text: string): string[] {
    const blocks = parseMarkedResponse(text);
    if (blocks.length <= 1) return blocks;
    if (env.MESSAGE_SPLIT_RANDOMIZE) {
        return randomPartition(blocks);
    }
    return blocks;
}
