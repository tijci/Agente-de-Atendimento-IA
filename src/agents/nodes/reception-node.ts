import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, AIMessage } from "@langchain/core/messages";
import { AgentState } from "../../state/conversation-state";
import { env } from "../../config/env";
import { logger } from "../../utils/logger";
import { z } from "zod";

const llm = new ChatOpenAI({
    model: env.OPENAI_MODEL,
    temperature: env.OPEN_AI_TEMPERATURE,
    maxTokens: 600,
})

const routerSchema = z.object({
    intent: z.enum(["COMPRAR", "ALUGAR", "ANUNCIAR", "OUTROS"]).nullable().describe("A intenção do cliente: COMPRAR, ALUGAR, ANUNCIAR, OUTROS ou null se ainda for incerta."),
    reply: z.string().nullable().describe("Mensagem curta e amigável sem markdown se intent for OUTROS ou null. Nula caso contrário."),
})

const SYSTEM_PROMPT = `
Você é o Daniel, recepcionista virtual da Julio Casas Imóveis.
Sua única função é identificar o objetivo do cliente com base no histórico de mensagens.
Classifique o objetivo nas seguintes opções:
- "COMPRAR": Cliente quer comprar um imóvel (casa, apartamento, etc.)
- "ALUGAR": Cliente quer alugar um imóvel.
- "ANUNCIAR": Cliente é proprietário e quer colocar o imóvel para vender ou alugar (anunciar).
- "OUTROS": Outros assuntos como financeiro, suporte, reclamações ou falar com humano sem interesse imobiliário.
- null: A intenção ainda é incerta (ex: saudações iniciais como "olá", "bom dia").
Se a intenção for "COMPRAR", "ALUGAR" ou "ANUNCIAR", defina o campo 'reply' como nulo (null). O sistema irá redirecionar o cliente automaticamente.
Se a intenção for null, defina o campo 'reply' com uma saudação simpática e pergunte de forma direta e curta como você pode ajudar (se quer comprar, alugar ou anunciar).
Se a intenção for "OUTROS", defina o campo 'reply' explicando de forma curta que nosso atendimento automático é para compra, locação e captação de imóveis, e avise que um atendente entrará em contato.
REGRA DE IMAGEM / FOTO (CRÍTICA):
- Se a última mensagem do cliente contiver a marcação "[FOTO ENVIADA PELO CLIENTE]", classifique a intenção OBRIGATORIAMENTE como "COMPRAR".
- Não envie nenhuma mensagem de resposta ('reply' deve ser null) pois o SDR tratará a imagem buscando no banco de dados.

`;

export const receptionNode = async (state: typeof AgentState.State) => {
    logger.info({ phoneNumber: state.phoneNumber }, '📞 Recepcionista triando mensagem...');
    const structuredLlm = llm.withStructuredOutput(routerSchema);
    const messagesWithSystem = [
        new SystemMessage(SYSTEM_PROMPT),
        ...state.messages,
    ];
    const result = await structuredLlm.invoke(messagesWithSystem);
    logger.info({ result }, '✅ Triagem realizada');
    let currentAgent: 'RECEPCIONISTA' | 'SDR' | 'CAPTADOR' = 'RECEPCIONISTA';
    if (result.intent === 'COMPRAR' || result.intent === 'ALUGAR') {
        currentAgent = 'SDR';
    } else if (result.intent === 'ANUNCIAR') {
        currentAgent = 'CAPTADOR';
    }
    const updates: any = {
        intent: result.intent,
        currentAgent,
    };
    if (result.reply) {
        updates.messages = [new AIMessage(result.reply)];
    }
    return updates;
}