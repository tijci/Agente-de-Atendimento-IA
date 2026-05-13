import 'dotenv/config';

export const env = {
    PORT: Number(process.env.PORT) || 5173,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
    OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    OPEN_AI_TEMPERATURE: Number(process.env.OPEN_AI_TEMPERATURE || '0.1'),
    NEPPO_API_URL: process.env.NEPPO_API_URL || '',
    NEPPO_API_TOKEN: process.env.NEPPO_API_TOKEN || '',
    NEPPO_GROUP_NAME: process.env.NEPPO_GROUP_NAME || '',
    NEPPO_USER_ID: Number(process.env.NEPPO_USER_ID) || 0,
    NEPPO_GROUP_CONF_ID: Number(process.env.NEPPO_GROUP_CONF_ID) || 0,
    NEPPO_CUSTOMER_SECRET: process.env.NEPPO_CUSTOMER_SECRET || '',
    NEPPO_CUSTOMER_KEY: process.env.NEPPO_CUSTOMER_KEY || '',
    NEPPO_USERNAME: process.env.NEPPO_USERNAME || '',
    NEPPO_PASSWORD: process.env.NEPPO_PASSWORD || '',
    KSI_API_URL: process.env.KSI_API_URL || '',
    KSI_API_TOKEN: process.env.KSI_API_TOKEN || '',

} as const;