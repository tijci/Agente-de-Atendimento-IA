import { env } from '../config/env';

export const sleep = (ms: number) => {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export const randomInterMessageDelayMs = (): number => {
    const min = env.MESSAGE_DELAY_MIN_MS;
    const max = env.MESSAGE_DELAY_MAX_MS;
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

export const calculateHumanDelay = (text: string): number => {    const BASE_VALUE = 1500;
    const MAX_VALUE = 5000;
    const perCharacter = 20;
    const calculatedValue = BASE_VALUE + text.length * perCharacter;


    return Math.min(MAX_VALUE, Math.max(BASE_VALUE, calculatedValue));
}