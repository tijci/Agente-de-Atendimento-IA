import { Annotation, messagesStateReducer } from "@langchain/langgraph"
import { BaseMessage } from "@langchain/core/messages"

interface LeadInfo {
    name?: string;
    email?: string;
    interest: 'VENDA' | 'LOCACAO' | null;
    typeProperty?: string;
    region?: string;
    priceRange?: { min: number; max: number };
    bedrooms?: number;
    observation?: string;
}

interface CaptacaoInfo {
    ownerName?: string;
    ownerEmail?: string;
    propertyType?: string;
    propertyAddress?: string;
    targetValue?: number;
    observations?: string;
}

export const AgentState = Annotation.Root({
    messages: Annotation<BaseMessage[]>({
        reducer: messagesStateReducer,
        default: () => [],
    }),
    phoneNumber: Annotation<string>({
        reducer: (_, novo) => novo,
        default: () => '',
    }),
    currentAgent: Annotation<'RECEPCIONISTA' | 'SDR' | 'CAPTADOR'>({
        reducer: (_, novo) => novo,
        default: () => 'RECEPCIONISTA',
    }),
    intent: Annotation<'COMPRAR' | 'ALUGAR' | 'ANUNCIAR' | 'OUTROS' | null>({
        reducer: (_, novo) => novo,
        default: () => null,
    }),
    leadInfo: Annotation<LeadInfo>({
        reducer: (atual, novo) => ({ ...atual, ...novo }),
        default: () => ({ interest: null }),
    }),
    captacaoInfo: Annotation<CaptacaoInfo>({
        reducer: (atual, novo) => ({ ...atual, ...novo }),
        default: () => ({}),
    }),
    leadCreated: Annotation<boolean>({
        reducer: (_, novo) => novo,
        default: () => false,
    }),
})
