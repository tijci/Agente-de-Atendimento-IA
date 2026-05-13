export const sleep = (ms: number) => {
    new Promise(resolve => setTimeout(resolve, ms));
}

export const calculateHumanDelay = (text: string): number => {
    const BASE_VALUE = 1500;
    const MAX_VALUE = 5000;
    const perCharacter = 20;
    const calculatedValue = BASE_VALUE + text.length * perCharacter;


    return Math.min(MAX_VALUE, Math.max(BASE_VALUE, calculatedValue));
}