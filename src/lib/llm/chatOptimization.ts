import { ChatMessage } from '@/types';
import { LLMProvider } from './types';

export interface ChatOptimizationPlan {
  historyWindow: number;
  contextMaxChars: number;
  temperature: number;
  maxTokens: number;
  extra: Record<string, unknown>;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateHistoryTokens(messages: ChatMessage[], historyWindow: number): number {
  return messages
    .slice(-historyWindow)
    .reduce((sum, msg) => sum + estimateTokens(msg.content), 0);
}

const RESPONSE_RESERVE = 800;
const SYSTEM_PROMPT_RESERVE = 300;
const HISTORY_WINDOW = 6;

export function buildChatOptimizationPlan(
  provider: LLMProvider,
  question: string,
  messages: ChatMessage[],
  options?: { modelContextLength?: number }
): ChatOptimizationPlan {
  const contextLength = options?.modelContextLength ?? 0;

  const questionTokens = estimateTokens(question);
  const historyTokens = estimateHistoryTokens(messages, HISTORY_WINDOW);
  const overhead = questionTokens + historyTokens + SYSTEM_PROMPT_RESERVE + RESPONSE_RESERVE;

  const contextTokens = Math.max(0, contextLength - overhead);
  const contextMaxChars = contextTokens * 4;

  const extra: Record<string, unknown> = provider === 'ollama'
    ? { ...(contextLength > 0 ? { num_ctx: contextLength } : {}), top_p: 0.9, keep_alive: '15m' }
    : { top_p: 0.9 };

  return {
    historyWindow: HISTORY_WINDOW,
    contextMaxChars,
    temperature: 0.05,
    maxTokens: RESPONSE_RESERVE,
    extra,
  };
}
