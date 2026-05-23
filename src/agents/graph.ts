/**
 * Grafo LangGraph: nó SDR (Ana) ↔ ferramenta buscar_imoveis.
 * @module agents/graph
 * @see docs/MODULES.md#srcagentsgraphts
 * @see docs/ARCHITECTURE.md
 */
import { StateGraph, START, END } from "@langchain/langgraph";
import { AgentState } from "../state/conversation-state";
import { sdrNode } from "./nodes/sdr-node";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { logger } from "../utils/logger";
import { MemorySaver } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { searchPropertiesTool } from "./tools/search-properties";
import { findLastHumanContent, shouldForcePropertySearch } from "../utils/search-intent";

const toolsNode = new ToolNode([searchPropertiesTool]);

const forceSearchNode = async (state: typeof AgentState.State) => {
    const pedido = findLastHumanContent(state.messages);
    logger.info({ phoneNumber: state.phoneNumber, pedido }, '🔁 Recuperação: busca obrigatória após resposta sem tool');

    const raw = await searchPropertiesTool.invoke({ pedido_livre: pedido });
    const toolCallId = `forced_${Date.now()}`;

    return {
        messages: [
            new AIMessage({
                content: '',
                tool_calls: [
                    {
                        id: toolCallId,
                        name: 'buscar_imoveis',
                        args: { pedido_livre: pedido },
                    },
                ],
            }),
            new ToolMessage({
                content: typeof raw === 'string' ? raw : JSON.stringify(raw),
                tool_call_id: toolCallId,
                name: 'buscar_imoveis',
            }),
        ],
    };
};

const shouldContinue = (state: typeof AgentState.State) => {
    const lastMessage = state.messages[state.messages.length - 1];

    if (lastMessage._getType() === 'ai') {
        const ai = lastMessage as AIMessage;
        if (ai.tool_calls && ai.tool_calls.length > 0) {
            return 'tools';
        }
        if (shouldForcePropertySearch(state.messages)) {
            return 'force_search';
        }
    }

    return END;
};

const workflow = new StateGraph(AgentState)
    .addNode('sdr', sdrNode)
    .addNode('tools', toolsNode)
    .addNode('force_search', forceSearchNode)
    .addEdge(START, 'sdr')
    .addConditionalEdges('sdr', shouldContinue)
    .addEdge('tools', 'sdr')
    .addEdge('force_search', 'sdr');

const checkpointer = new MemorySaver();

const app = workflow.compile({ checkpointer });

function extractFinalAssistantText(messages: typeof AgentState.State['messages']): string {
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg._getType() !== 'ai') continue;
        const ai = msg as AIMessage;
        if (ai.tool_calls?.length) continue;
        const text = typeof ai.content === 'string' ? ai.content : '';
        if (text.trim()) return text;
    }
    return '';
}

export const processAIMessage = async (phoneNumber: string, text: string): Promise<string> => {
    logger.info({ phoneNumber, text }, '🎯 Iniciando grafo LangGraph...');
    const finalState = await app.invoke(
        { messages: [new HumanMessage(text)], phoneNumber },
        { configurable: { thread_id: phoneNumber } }
    );
    const reply = extractFinalAssistantText(finalState.messages);
    if (!reply) {
        logger.warn({ phoneNumber }, '⚠️ Grafo terminou sem texto final do assistente');
    }
    return reply;
};
