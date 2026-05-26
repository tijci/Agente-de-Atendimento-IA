/**
 * Grafo LangGraph: nó SDR (Ana) ↔ ferramenta buscar_imoveis.
 * @module agents/graph
 * @see docs/MODULES.md#srcagentsgraphts
 * @see docs/ARCHITECTURE.md
 */
import { StateGraph, START, END } from "@langchain/langgraph";
import { AgentState } from "../state/conversation-state";
import { receptionNode } from "./nodes/reception-node";
import { sdrNode } from "./nodes/sdr-node";
import { propertyScoutNode } from "./nodes/property-scout";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { logger } from "../utils/logger";
import { MemorySaver } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { searchPropertiesTool } from "./tools/search-properties";
import { findLastHumanContent, shouldForcePropertySearch } from "../utils/search-intent";

const toolsNode = new ToolNode([searchPropertiesTool]);

const routeAfterReception = (state: typeof AgentState.State) => {
    if (state.currentAgent === 'SDR') {
        return 'sdr';
    }
    if (state.currentAgent === 'CAPTADOR') {
        return 'captador';
    }
    return END;
}

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
    .addNode("reception", receptionNode)
    .addNode("sdr", sdrNode)
    .addNode("captador", propertyScoutNode)
    .addNode("tools", toolsNode)
    .addEdge(START, "reception")
    .addConditionalEdges("reception", routeAfterReception)
    .addConditionalEdges("sdr", shouldContinue)
    .addEdge("tools", "sdr")
    .addEdge("captador", END);

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
