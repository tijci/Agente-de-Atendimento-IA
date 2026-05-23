export interface HumanizedMessage {
    text: string;
    delayBefore: number;
    typingDuration: number;
}

export interface HumanizerOptions {
    minDelay?: number;
    maxDelay?: number;
    mergeProbability?: number;
    msPerChar?: number;

}

function parseBlocks(rawText: string): string[] {
    const blockRegex = /\[BLOCO_\d+\]([\s\S]*?)\[\/BLOCO_\d+\]/g;
    const blocks: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = blockRegex.exec(rawText)) !== null) {
        const content = match[1].trim();
        if (content.length > 0) {
            blocks.push(content);
        }
    }

    if (blocks.length === 0) {
        const fallback = rawText.trim();
        return fallback.length > 0 ? [fallback] : [];
    }

    return blocks;
}

function groupBlocks(blocks: string[], mergeProbability: number): string[] {
    if (blocks.length <= 1) return blocks;
    const groups: string[] = [];
    let i = 0;
    while (i < blocks.length) {
        const isFirst = i === 0;
        const isLast = i === blocks.length - 1;
        const hasNext = i + 1 < blocks.length;
        const nextIsLast = i + 1 === blocks.length - 1;
        const canMerge = hasNext && !isFirst && !isLast && !nextIsLast;
        const shouldMerge = canMerge && Math.random() < mergeProbability;

        if (shouldMerge) {
            groups.push(`${blocks[i]}\n\n${blocks[i + 1]}`);
            i += 2;
        } else {
            groups.push(blocks[i]);
            i++;
        }

        return groups;
    }

}

function randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function calcTypingDuration(text: string, msPerChar: number): number {
    const raw = text.length * msPerChar;
    return Math.min(raw, 3000);
}

export const sleep = (ms: number) => {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export const calculateHumanDelay = (text: string): number => {
    const BASE_VALUE = 1500;
    const MAX_VALUE = 5000;
    const perCharacter = 20;
    const calculatedValue = BASE_VALUE + text.length * perCharacter;


    return Math.min(MAX_VALUE, Math.max(BASE_VALUE, calculatedValue));
}

export function randomHumanDelayMessage() {
    const MAX_TIME_MS = 5000;
    const MIN_TIME_MS = 1000;
    return sleep(Math.floor(Math.random() * (MAX_TIME_MS - MIN_TIME_MS + 1)) + MIN_TIME_MS);
}

export function humanizeResponse(
    rawText: string,
    options: HumanizerOptions = {}
): HumanizedMessage[] {
    const {
        minDelay = 1000,
        maxDelay = 4500,
        mergeProbability = 0.35,
        msPerChar = 28,
    } = options;

    if (!rawText?.trim()) return [];
    const blocks = parseBlocks(rawText);
    if (blocks.length === 0) return [];
    const groups = groupBlocks(blocks, mergeProbability);
    return groups.map((text, index) => ({
        text,
        delayBefore: index === 0 ? 0 : randomInt(minDelay, maxDelay),
        typingDuration: calcTypingDuration(text, msPerChar),
    }));
}