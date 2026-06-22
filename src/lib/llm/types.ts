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

/**
 * Failure classification. The kind is the single source of truth for how a caller
 * (and the call surface) reacts to an error; `retryable` is derived from it.
 */
export type FailureKind =
  | 'server-unreachable' // network TypeError / DNS / connection refused     (transport retry)
  | 'server-error' // the server responded with a 5xx (transient)            (transport retry)
  | 'timeout' // call exceeded its time budget; HTTP 408/504                 (transport retry)
  | 'model-missing' // 404 / model not loaded on the server (don't retry)
  | 'model-too-small' // window < MIN_VIABLE_CONTEXT_TOKENS (preflight, budgeting layer)
  | 'input-too-large' // request exceeds budget, not dispatched (preflight, budgeting layer)
  | 'request-rejected' // 4xx — the request was malformed or refused (don't retry)
  | 'invalid-response' // malformed JSON / empty / schema failure            (application retry)
  | 'wrong-answer' // structurally valid but semantically unusable (don't retry)
  | 'cancelled' // caller aborted the request (don't retry)
  | 'unknown'; // anything not classified above

/**
 * Transport-retryable kinds (used by the call surface's retry loop). Application retry
 * (`invalid-response`) is handled by the retry engine, not this set. See spec §7.
 */
export const RETRYABLE_KINDS: ReadonlySet<FailureKind> = new Set([
  'server-unreachable',
  'server-error',
  'timeout',
]);

/**
 * LLM error carrying a structured kind. Adapters assign the kind at the point a
 * provider outcome is observed; the surface derives retryability from it rather
 * than re-deriving from the message.
 */
export class LLMError extends Error {
  constructor(
    message: string,
    public readonly kind: FailureKind,
  ) {
    super(message);
    this.name = 'LLMError';
  }

  /** `true` only for transient kinds (network error, 5xx). */
  get retryable(): boolean {
    return RETRYABLE_KINDS.has(this.kind);
  }
}

export function isLLMError(e: unknown): e is LLMError {
  return e instanceof LLMError;
}

// ── Adapter Interface ────────────────────────────────────────────────────────

/**
 * Subset of JSON Schema used by the structured-output schemas. Types the keys we actually
 * use so schema typos are caught at compile time. If a schema ever needs a feature outside
 * this subset (anyOf/oneOf/$ref/pattern), extend this interface — do not bypass it.
 */
export interface JSONSchema {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null' | string[];
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema;
  required?: string[];
  enum?: unknown[];
  additionalProperties?: boolean;
  description?: string;
}

export interface AdapterOptions {
  temperature: number;
  responseFormat: 'json' | 'text';
  responseSchema?: JSONSchema;
  schemaName?: string;
  maxOutputTokens?: number;
  topP?: number;
  contextWindow?: number;
  systemPrompt?: string;
  signal: AbortSignal;
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
  listModels(baseUrl: string, signal: AbortSignal, selectedModel?: string): Promise<ModelInfo[]>;
  checkStatus(baseUrl: string, signal: AbortSignal, selectedModel?: string): Promise<StatusResult>;
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

/**
 * Global kill-switch for on-wire JSON Schema enforcement (grammar-constrained decoding).
 *
 * WHY IT'S OFF: sending `json_schema` on the wire breaks LM Studio's constrained decoding
 * for the extraction calls. Traced via live probes against a real bank statement
 * (2026-06-21): on qwen3-4b the model falls into a non-terminating repetition loop
 * (8k+ tokens of repeated whitespace, never finishes); on qwen3.5-4b it terminates but
 * emits malformed JSON. The SAME prompts/models extract cleanly in text mode (no
 * response_format). Confirmed via a 2x2 matrix (prompt-skeleton x on-wire-schema): on
 * qwen3-4b, the on-wire schema breaks extraction regardless of the prompt, and stripping
 * the prompt skeleton is an independent second breakage. Only original-prompt + no-schema
 * works on qwen3-4b. This is not statement-specific. Ollama has NOT been tested with
 * json_schema — it may behave differently.
 *
 * BEHAVIOR:
 * - false (default): the adapters IGNORE responseSchema and send text mode (no
 *   response_format / no `format`), even though call sites still pass responseFormat:'json'
 *   + schema. Structured output relies on the prompt + parser, as before this feature.
 * - true: the adapters send the schema envelope (OpenAI `json_schema` strict:false /
 *   Ollama `format:<schema>`) exactly as built. Flip back to true to re-enable after
 *   LM Studio's constrained decoding is fixed (bug report pending).
 *
 * The schema constants, type fields, and call-site wiring all remain in place so this is
 * a one-line reversible toggle, not a deletion.
 */
export const ENFORCE_JSON_SCHEMA_ON_WIRE = false;

// ── Client Options ───────────────────────────────────────────────────────────

export interface LLMCallOptions {
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  contextWindow?: number;
  responseFormat: 'json' | 'text';
  responseSchema?: JSONSchema;
  schemaName?: string;
  systemPrompt?: string;
  stage?: string;
  signal?: AbortSignal;
  timeout?: number;
}

// ── Client Interface (implemented by client.ts) ──────────────────────────────

export interface LLMClient {
  generate(baseUrl: string, model: string, prompt: string, options: LLMCallOptions): Promise<string>;
  chatStream(baseUrl: string, model: string, messages: { role: string; content: string }[], options: LLMCallOptions): AsyncIterable<ChatChunk>;
  listModels(baseUrl: string, selectedModel?: string): Promise<ModelInfo[]>;
  checkStatus(baseUrl: string, selectedModel?: string): Promise<StatusResult>;
}
