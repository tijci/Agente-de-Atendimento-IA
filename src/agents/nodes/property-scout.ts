import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, AIMessage } from "@langchain/core/messages";
import { AgentState } from "../../state/conversation-state";
import { env } from "../../config/env";
import { logger } from "../../utils/logger";
import { z } from "zod";


const llm = new ChatOpenAI({
    model: env.OPENAI_MODEL,
    temperature: env.OPEN_AI_TEMPERATURE,
    maxTokens: 500,
});

const captadorSchema = z.object({
    reply: z.string().describe("Mensagem simpática para o cliente via WhatsApp (sem markdown)."),
    extractedInfo: z.object({
        ownerName: z.string().optional().describe("Nome do proprietário."),
        ownerEmail: z.string().optional().describe("E-mail do proprietário."),
        propertyType: z.string().optional().describe("Tipo de imóvel (casa, apartamento, etc.)."),
        propertyAddress: z.string().optional().describe("Endereço ou bairro do imóvel."),
        targetValue: z.number().optional().describe("Valor pretendido de venda ou aluguel."),
        observations: z.string().optional().describe("Outras observações sobre o imóvel."),
    }).optional(),
    isComplete: z.boolean().describe("Se coletou pelo menos Nome, Tipo de Imóvel, Endereço e Valor."),
});


const SYSTEM_PROMPT = `
Você é o Daniel, especialista em captação de imóveis da Julio Casas Imóveis.
Seu objetivo é conversar com o proprietário que deseja anunciar (vender ou alugar) o seu imóvel e coletar os dados básicos necessários.
Responda como se estivesse no WhatsApp (mensagens simpáticas, diretas, 1 a 2 frases por vez).
Pergunte uma informação de cada vez de forma natural, para não cansar o cliente.
Dados obrigatórios a serem coletados:
1. Nome completo (ou primeiro nome) do proprietário.
2. E-mail de contato (se recusar, use o nome dele + "@ficticio.com").
3. Tipo do imóvel (casa, apartamento, terreno, comercial, etc.).
4. Endereço ou bairro onde fica o imóvel.
5. Valor pretendido para venda ou locação.
Se a informação já estiver listada em "Dados já coletados até agora", NÃO pergunte novamente. Passe para a próxima informação pendente.
Quando coletar todas as informações obrigatórias, defina o campo 'isComplete' como true e envie uma mensagem final explicando que a captação foi registrada e que o Osmar irá entrar em contato para continuar o processo de captação.
`;

export const propertyScoutNode = async (state: typeof AgentState.State) => {
    logger.info({ phoneNumber: state.phoneNumber }, '🏠 Captador processando mensagem...');
    const structuredLlm = llm.withStructuredOutput(captadorSchema);
    const infoContext = `
Dados já coletados até agora:
- Nome: ${state.captacaoInfo?.ownerName || 'Não coletado'}
- E-mail: ${state.captacaoInfo?.ownerEmail || 'Não coletado'}
- Tipo de Imóvel: ${state.captacaoInfo?.propertyType || 'Não coletado'}
- Endereço: ${state.captacaoInfo?.propertyAddress || 'Não coletado'}
- Valor Pretendido: ${state.captacaoInfo?.targetValue ? 'R$ ' + state.captacaoInfo.targetValue : 'Não coletado'}
- Observações: ${state.captacaoInfo?.observations || 'Nenhuma'}
`;
    const messagesWithSystem = [
        new SystemMessage(SYSTEM_PROMPT + infoContext),
        ...state.messages,
    ];

    const result = await structuredLlm.invoke(messagesWithSystem);
    logger.info({ result }, '✅ Captador respondeu');

    const updates: any = {
        messages: [new AIMessage(result.reply)],
        captacaoInfo: { ...state.captacaoInfo, ...result.extractedInfo },
    };
    if (result.isComplete) {
        updates.currentAgent = 'RECEPCIONISTA';
    }
    return updates;
}