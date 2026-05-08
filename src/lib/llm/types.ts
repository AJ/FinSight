/**
 * Shared types for LLM clients.
 */

export type LLMProvider = 'ollama' | 'lmstudio';

export interface LLMRuntimeConfig {
  provider: LLMProvider;
  baseUrl: string;
  model: string;
}

export interface ModelInfo {
  id: string;
  contextLength?: number;
}

export const DEFAULT_URLS: Record<LLMProvider, string> = {
  ollama: 'http://localhost:11434',
  lmstudio: 'http://localhost:1234',
};

/**
 * Error with retry classification.
 * retryable=true means safe to retry (timeout, network error).
 * retryable=false means don't retry (model not found, invalid prompt).
 */
export class LLMError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'LLMError';
  }
}

// ── Adapter Error ─────────────────────────────────────────────────────────────

export interface AdapterError extends Error {
  readonly status: number;
}

export function createAdapterError(message: string, status: number): AdapterError {
  return Object.assign(new Error(message), { status }) as AdapterError;
}

export function isAdapterError(e: unknown): e is AdapterError {
  return e instanceof Error && 'status' in e && typeof (e as { status: unknown }).status === 'number';
}

// ── Adapter Interface ────────────────────────────────────────────────────────

export interface AdapterOptions {
  temperature: number;
  maxTokens?: number;
  signal: AbortSignal;
  extra?: Record<string, unknown>;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface ChatChunk {
  delta: string;
  usage?: TokenUsage;
  done: boolean;
}

export interface StatusResult {
  connected: boolean;
  models: ModelInfo[];
  selectedModel: string | null;
}

export interface LLMAdapter {
  generate(
    baseUrl: string,
    model: string,
    prompt: string,
    options: AdapterOptions,
  ): Promise<{ text: string; usage?: TokenUsage }>;
  chatStream(
    baseUrl: string,
    model: string,
    messages: { role: string; content: string }[],
    options: AdapterOptions,
  ): AsyncIterable<ChatChunk>;
  listModels(baseUrl: string, signal: AbortSignal): Promise<ModelInfo[]>;
  checkStatus(baseUrl: string, signal: AbortSignal): Promise<StatusResult>;
}

// ── Provider Config ──────────────────────────────────────────────────────────

export interface ProviderConfig {
  adapter: 'ollama' | 'openai';
  defaultUrl: string;
  name: string;
}

export const PROVIDERS: Record<LLMProvider, ProviderConfig> = {
  ollama:   { adapter: 'ollama', defaultUrl: 'http://localhost:11434', name: 'Ollama' },
  lmstudio: { adapter: 'openai', defaultUrl: 'http://localhost:1234',  name: 'LM Studio' },
};

// ── Client Options ───────────────────────────────────────────────────────────

export interface LLMCallOptions {
  temperature?: number;
  maxTokens?: number;
  stage?: string;
  signal?: AbortSignal;
  runtime?: LLMRuntimeConfig;
  timeout?: number;
  extra?: Record<string, unknown>;
}

// ── Client Interface (implemented by client.ts) ──────────────────────────────

export interface LLMClient {
  generate(baseUrl: string, model: string, prompt: string, options?: LLMCallOptions): Promise<string>;
  chatStream(baseUrl: string, model: string, messages: { role: string; content: string }[], options?: LLMCallOptions): AsyncIterable<ChatChunk>;
  listModels(baseUrl: string): Promise<ModelInfo[]>;
  checkStatus(baseUrl: string): Promise<StatusResult>;
}
