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

export const AgentState = Annotation.Root({
    messages: Annotation<BaseMessage[]>({
        reducer: messagesStateReducer,
        default: () => [],
    }),
    phoneNumber: Annotation<string>({
        reducer: (_, novo) => novo,
        default: () => '',
    }),
    step: Annotation<'TRIAGEM' | 'CONVERSA' | 'BUSCA' | 'QUALIFICACAO' | 'HANDOFF'>({
        reducer: (_, novo) => novo,
        default: () => 'TRIAGEM',
    }),
    leadInfo: Annotation<LeadInfo>({
        reducer: (atual, novo) => ({ ...atual, ...novo }),
        default: () => ({ interest: null }),
    }),
    leadCreated: Annotation<boolean>({
        reducer: (_, novo) => novo,
        default: () => false,
    }),
})
