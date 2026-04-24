// src/lib/llm/types.ts

/**
 * Shared types for LLM clients.
 */

export type LLMProvider = 'ollama' | 'lmstudio';

export interface LLMRuntimeConfig {
  provider: LLMProvider;
  baseUrl: string;
  model: string;
}

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

/**
 * LLM call options for controlling generation behavior.
 */
export type LLMCallOptions = {
  /**
   * Temperature for generation (0 = deterministic, 1 = creative).
   * Default: 0 (required for deterministic extraction)
   */
  temperature?: number;

  /**
   * Maximum tokens to generate.
   * Default: 4096
   * Recommended per stage:
   *   - type_detection: 512
   *   - summary: 2048
   *   - transactions: 12288
   *   - rewards: 1024
   */
  maxTokens?: number;

  /**
   * Stage name for logging and error messages.
   * Examples: "type_detection", "summary", "transactions", "rewards"
   */
  stage?: string;

  /**
   * Optional abort signal for cancelling in-flight requests.
   */
  signal?: AbortSignal;

  /**
   * Explicit runtime config. Parser-neutralized flows should pass this
   * instead of relying on hidden store state.
   */
  runtime?: LLMRuntimeConfig;
};

/**
 * LLM Error with retry classification.
 * Use this to distinguish transient failures (retry) from permanent failures (don't retry).
 */
export class OllamaError extends Error {
  constructor(
    message: string,
    public retryable: boolean
  ) {
    super(message);
    this.name = 'OllamaError';
  }
}

export class LMStudioError extends Error {
  constructor(
    message: string,
    public retryable: boolean
  ) {
    super(message);
    this.name = 'LMStudioError';
  }
}
