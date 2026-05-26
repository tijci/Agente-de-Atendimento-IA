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
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
    if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
        return "tools";
    }
    return END;
}

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

export const processAIMessage = async (phoneNumber: string, text: string): Promise<string> => {
    logger.info({ phoneNumber, text }, '🎯 Iniciando grafo LangGraph...');
    const finalState = await app.invoke(
        { messages: [new HumanMessage(text)], phoneNumber },
        { configurable: { thread_id: phoneNumber } }
    );
    return finalState.messages[finalState.messages.length - 1].content as string;
}