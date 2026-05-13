import { StateGraph, START, END } from "@langchain/langgraph";
import { AgentState } from "../state/conversation-state";
import { sdrNode } from "./nodes/sdr-node";
import { HumanMessage } from "@langchain/core/messages";
import { logger } from "../utils/logger";

const workflow = new StateGraph(AgentState)
    .addNode("sdr", sdrNode)
    .addEdge(START, "sdr")
    .addEdge("sdr", END)

const app = workflow.compile();

export const processAIMessage = async (phoneNumber: string, text: string): Promise<string> => {
    logger.info({ phoneNumber, text }, '🎯 Iniciando grafo LangGraph...');
    const finalState = await app.invoke({
        messages: [new HumanMessage(text)],
        phoneNumber,
    });
    const lastMessage = finalState.messages[finalState.messages.length - 1];
    const responseAI = String(lastMessage.content);
    logger.info({ phoneNumber, responseAI }, '🏁 Grafo finalizado');
    return responseAI;
}