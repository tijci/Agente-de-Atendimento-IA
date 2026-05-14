import { StateGraph, START, END } from "@langchain/langgraph";
import { AgentState } from "../state/conversation-state";
import { sdrNode } from "./nodes/sdr-node";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { logger } from "../utils/logger";
import { MemorySaver } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { searchPropertiesTool } from "./tools/search-properties";

const toolsNode = new ToolNode([searchPropertiesTool]);

const shouldContinue = (state: typeof AgentState.State) => {
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
    if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
        return "tools";
    }
    return END;
}

const workflow = new StateGraph(AgentState)
    .addNode("sdr", sdrNode)
    .addNode("tools", toolsNode)
    .addEdge(START, "sdr")
    .addConditionalEdges("sdr", shouldContinue)
    .addEdge("tools", "sdr");

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