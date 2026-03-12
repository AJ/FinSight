import { ChatMessage } from '@/types';
import { LLMProvider } from './types';

export interface ChatOptimizationPlan {
  historyWindow: number;
  contextTopK: number;
  contextMaxChars: number;
  requestOptions: Record<string, unknown>;
}

function estimateTokens(text: string): number {
  // Fast heuristic: ~4 chars/token for English-centric prompts.
  return Math.ceil(text.length / 4);
}

function estimateHistoryTokens(messages: ChatMessage[], historyWindow: number): number {
  return messages
    .slice(-historyWindow)
    .reduce((sum, msg) => sum + estimateTokens(msg.content), 0);
}

function isBroadQuery(query: string): boolean {
  return /\b(summary|summarize|overview|overall|all spending|spending pattern|monthly trend)\b/i.test(query);
}

function isFollowUpQuery(query: string): boolean {
  return /\b(this|that|those|it|them|same|above|previous|earlier)\b/i.test(query);
}

function chooseHistoryWindow(query: string): number {
  if (isFollowUpQuery(query)) return 8;
  if (isBroadQuery(query)) return 5;
  return 6;
}

function chooseContextTopK(query: string): number {
  if (isBroadQuery(query)) return 0; // summary-only route for broad queries
  if (/\b(merchant|payee|transaction|amount|refund|charge)\b/i.test(query)) return 12;
  return 8;
}

function chooseContextMaxChars(query: string): number {
  if (isBroadQuery(query)) return 2600;
  return 3400;
}

function buildOllamaOptions(estimatedInputTokens: number): Record<string, unknown> {
  // Keep ctx tight for latency while allowing moderate follow-up history.
  const numCtx = Math.max(4096, Math.min(8192, estimatedInputTokens * 2 + 1200));
  return {
    num_ctx: numCtx,
    num_predict: 700,
    temperature: 0.05,
    top_p: 0.9,
    keep_alive: '15m',
  };
}

function buildLMStudioOptions(estimatedInputTokens: number): Record<string, unknown> {
  const maxTokens = estimatedInputTokens > 2500 ? 500 : 700;
  return {
    max_tokens: maxTokens,
    temperature: 0.05,
    top_p: 0.9,
  };
}

export function buildChatOptimizationPlan(
  provider: LLMProvider,
  question: string,
  messages: ChatMessage[]
): ChatOptimizationPlan {
  const historyWindow = chooseHistoryWindow(question);
  const contextTopK = chooseContextTopK(question);
  const contextMaxChars = chooseContextMaxChars(question);

  const estimatedInputTokens =
    estimateTokens(question) + estimateHistoryTokens(messages, historyWindow) + estimateTokens('context');

  const requestOptions =
    provider === 'ollama'
      ? buildOllamaOptions(estimatedInputTokens)
      : buildLMStudioOptions(estimatedInputTokens);

  return {
    historyWindow,
    contextTopK,
    contextMaxChars,
    requestOptions,
  };
}
