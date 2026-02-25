/**
 * Shared types for LLM clients.
 */

export type LLMProvider = 'ollama' | 'lmstudio';

export interface LLMClient {
  checkStatus(baseUrl: string): Promise<{ connected: boolean; models: string[]; selectedModel: string | null }>;
  listModels(baseUrl: string): Promise<string[]>;
  generate(baseUrl: string, model: string, prompt: string, options?: Record<string, unknown>): Promise<string>;
  chatStream(baseUrl: string, model: string, messages: { role: string; content: string }[], options?: Record<string, unknown>): Promise<ReadableStream<Uint8Array>>;
}

export const DEFAULT_URLS: Record<LLMProvider, string> = {
  ollama: 'http://localhost:11434',
  lmstudio: 'http://localhost:1234',
};
