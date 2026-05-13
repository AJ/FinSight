export interface ChatMessageLike {
  role: string;
  content: string;
}

export function buildSystemPrompt(statementContext: string): string {
  return `You are a helpful financial assistant. You have access to the user's bank statement data below. Answer questions accurately and concisely.

${statementContext || 'No statement data available yet.'}

Guidelines:
- Use ONLY the provided statement context for factual answers. Do not invent or assume missing transactions, balances, merchants, categories, or dates.
- Be concise and precise with numbers.
- Format currency amounts properly.
- If asked for calculations, show your work briefly.
- If the data doesn't contain enough info, say so clearly.
- When answering with amounts, trends, counts, or conclusions, mention the relevant transaction dates and/or transactions you used.
- The relevant transactions section is sampled and not exhaustive. If the sampled context is not enough to support a confident answer, say that explicitly.`;
}

export function buildChatMessages(
  messages: ChatMessageLike[],
  historyWindow: number,
  systemPrompt: string,
  userText: string,
): { role: string; content: string }[] {
  return [
    { role: 'system', content: systemPrompt },
    ...messages.slice(-historyWindow).map((m) => ({
      role: m.role,
      content: m.content,
    })),
    { role: 'user', content: userText },
  ];
}

export function classifyStreamError(err: unknown): string {
  if (err instanceof Error && err.message.toLowerCase().includes('timed out')) {
    return '⚠️ Request timed out — the model took too long to respond.';
  }
  return '⚠️ Connection error — check that your LLM is running and try again.';
}

export interface ModelInfoLike {
  id: string;
  contextLength?: number | null;
}

export interface ModelSelection {
  modelId: string;
  contextLength: number | null;
}

export function resolveModelSelection(
  currentModel: string | null | undefined,
  models: ModelInfoLike[],
): ModelSelection | null {
  const modelIds = models.map((m) => m.id);
  if (modelIds.length === 0) return null;

  const needsSwitch = !currentModel || !modelIds.includes(currentModel);
  if (!needsSwitch) {
    return null;
  }

  const selected = models[0];
  return { modelId: selected.id, contextLength: selected.contextLength ?? null };
}

export function findModelContextLength(
  models: ModelInfoLike[],
  modelId: string,
): number | null {
  return models.find((m) => m.id === modelId)?.contextLength ?? null;
}
