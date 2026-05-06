import { ChatMessage } from '@/types';
import { LLMProvider } from './types';

export interface ChatOptimizationPlan {
  historyWindow: number;
  contextMaxChars: number;
  requestOptions: Record<string, unknown>;
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
  const contextLength = options?.modelContextLength ?? 4096;

  const questionTokens = estimateTokens(question);
  const historyTokens = estimateHistoryTokens(messages, HISTORY_WINDOW);
  const overhead = questionTokens + historyTokens + SYSTEM_PROMPT_RESERVE + RESPONSE_RESERVE;

  const contextTokens = Math.max(0, contextLength - overhead);
  const contextMaxChars = contextTokens * 4;

  const requestOptions: Record<string, unknown> =
    provider === 'ollama'
      ? { num_ctx: contextLength, num_predict: RESPONSE_RESERVE, temperature: 0.05, top_p: 0.9, keep_alive: '15m' }
      : { max_tokens: RESPONSE_RESERVE, temperature: 0.05, top_p: 0.9 };

  return {
    historyWindow: HISTORY_WINDOW,
    contextMaxChars,
    requestOptions,
  };
}
