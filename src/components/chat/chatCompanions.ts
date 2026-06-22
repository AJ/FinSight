export interface ChatMessageLike {
  role: string;
  content: string;
}

/**
 * Build the chat message list: the constant chat system prompt, the recent history, and a
 * single user message carrying the retrieved statement context plus the question (spec §10 —
 * per-call data is user content, not system content). The system prompt itself is the
 * `CHAT_SYSTEM_PROMPT` constant from `lib/llm/prompts`; the caller passes it in. When there
 * is no context the user message is just the question.
 */
export function buildChatMessages(
  messages: ChatMessageLike[],
  historyWindow: number,
  systemPrompt: string,
  statementContext: string,
  userText: string,
): { role: string; content: string }[] {
  const userContent = statementContext
    ? `Statement context:\n${statementContext}\n\nQuestion: ${userText}`
    : userText;
  return [
    { role: 'system', content: systemPrompt },
    ...messages.slice(-historyWindow).map((m) => ({
      role: m.role,
      content: m.content,
    })),
    { role: 'user', content: userContent },
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
