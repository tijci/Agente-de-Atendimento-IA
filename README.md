# Agente de Atendimento IA — Julio Casas Imóveis

Sistema de atendimento automatizado via **WhatsApp** (plataforma **Neppo**), com agente conversacional **Ana** powered by **OpenAI** + **LangGraph**, e busca inteligente de imóveis por texto, código e imagem.

---

## Índice da documentação

| Documento | Conteúdo |
|-----------|----------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Arquitetura, fluxos de dados, diagramas |
| [docs/MODULES.md](docs/MODULES.md) | Cada arquivo, classe e função explicados |
| [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) | Variáveis de ambiente e configuração |
| [docs/AI-WORKER.md](docs/AI-WORKER.md) | Worker de busca vetorial, OCR e CLIP |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Como subir, testar e operar |

---

## Visão geral em 30 segundos

1. Cliente manda mensagem no WhatsApp → Neppo encaminha via **WebSocket STOMP** (ou webhook HTTP).
2. O servidor **agrupa mensagens** (debounce 15s) e chama o **LangGraph**.
3. O nó **SDR (Ana)** decide se responde direto ou chama a ferramenta **`buscar_imoveis`**.
4. A ferramenta roda em **thread separada** (`ai-worker`) com modelos de embedding, CLIP e OCR.
5. A resposta volta pelo **WebSocket** como mensagem de agente no chat Neppo.

---

## Stack tecnológica

| Camada | Tecnologia |
|--------|------------|
| Runtime | Node.js + TypeScript (`tsx`) |
| HTTP | Express 5 |
| Agente IA | LangChain + LangGraph + OpenAI (`gpt-4o-mini`) |
| Mensageria Neppo | STOMP sobre WebSocket (`@stomp/stompjs`, `ws`) |
| Busca de imóveis | `@xenova/transformers` (MiniLM + CLIP), Tesseract OCR, Sharp |
| Presença no painel | Puppeteer (opcional) |
| Áudio (transcrição) | Groq Whisper API |
| Logs | Pino |

---

## Estrutura de pastas

```
Agente-de-Atendimento-IA/
├── src/
│   ├── server.ts                 # Ponto de entrada HTTP + bootstrap Neppo
│   ├── config/env.ts             # Variáveis de ambiente tipadas
│   ├── agents/
│   │   ├── graph.ts              # Grafo LangGraph (SDR ↔ tools)
│   │   ├── nodes/sdr-node.ts     # Persona Ana + prompt + LLM
│   │   └── tools/search-properties.ts  # Ponte para ai-worker
│   ├── state/conversation-state.ts   # Estado do grafo (mensagens, lead)
│   ├── integrations/
│   │   ├── neppo-ws-client.ts    # Canal principal: WS + envio
│   │   ├── neppo-client.ts       # API REST alternativa (direct-message)
│   │   └── neppo-presence.ts     # Agente fantasma (Puppeteer)
│   ├── webhook/neppo-handler.ts  # Webhook POST /webhook/neppo
│   ├── utils/
│   │   ├── message-debouncer.ts  # Agrupa mensagens rápidas
│   │   ├── message-translator.ts # Áudio → texto, foto → instrução
│   │   ├── humanize.ts           # Utilitários de delay (parcial)
│   │   └── logger.ts
│   └── workers/ai-worker.ts      # Catálogo vetorial + buscas
├── data/vetores-cache.json       # Cache de embeddings (gerado em runtime)
├── test/                         # Scripts manuais
├── docs/                         # Documentação detalhada
├── .env                          # Segredos (não versionar)
└── package.json
```

---

## Como executar

```bash
npm install
cp .env.example .env   # se existir; senão configure .env manualmente
npm run dev            # sobe em http://127.0.0.1:5173
```

**Pré-requisitos:** chaves `OPENAI_API_KEY`, credenciais Neppo, `GROQ_API_KEY` (para áudio). Na primeira execução o worker baixa modelos e processa ~2700 imóveis — pode levar vários minutos.

**Health check:** `GET http://127.0.0.1:5173/health`

---

## Canais de entrada (2 formas)

| Canal | Arquivo | Quando usar |
|-------|---------|-------------|
| **WebSocket** (principal) | `neppo-ws-client.ts` | Servidor conectado 24/7 escutando fila STOMP |
| **Webhook HTTP** | `neppo-handler.ts` | Neppo faz POST para `/webhook/neppo` |

Ambos convergem em `processAIMessage()` → resposta via `neppoWsClient.sendMessageSequence()` (várias bolhas com delay aleatório, quando `MESSAGE_SPLIT_ENABLED=true`).

---

## Persona e regras de negócio

A corretora virtual **Ana** segue o `SYSTEM_PROMPT` em `sdr-node.ts`:

- Coleta **transação + tipo + região** antes da primeira busca.
- Apresenta no máximo **3 imóveis** por vez, com link `juliocasas.com.br`.
- Não inventa endereço, disponibilidade ou taxas.
- Coleta **nome + e-mail** antes de handoff para corretor humano.
- Suporta busca por **texto livre**, **código** (ex. L193) e **foto/print**.

Detalhes completos do prompt: ver [docs/MODULES.md](docs/MODULES.md#agentsnodessdr-nodets).

---

## Licença

ISC (ver `package.json`).
