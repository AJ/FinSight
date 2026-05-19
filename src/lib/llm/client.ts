import { LLMError, isAdapterError } from './types';
import type {
  LLMCallOptions,
  LLMClient,
  LLMProvider,
  ChatChunk,
  ModelInfo,
  StatusResult,
} from './types';
import { PROVIDERS } from './types';
import { SYSTEM_PROMPT } from './prompts';
import { ollamaAdapter } from './ollamaAdapter';
import { createOpenAIAdapter } from './openaiAdapter';
import { debugLog } from '@/lib/utils/debug';

const GENERATE_TIMEOUT_MS = 15 * 60 * 1000;
const CHAT_STREAM_TIMEOUT_MS = 180 * 1000;

function createAbortSignal(
  timeoutMs: number,
  externalSignal?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs);
  const abortFromExternal = () => controller.abort(externalSignal?.reason);

  if (externalSignal) {
    if (externalSignal.aborted) {
      abortFromExternal();
    } else {
      externalSignal.addEventListener('abort', abortFromExternal, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', abortFromExternal);
      }
    },
  };
}

function classifyError(e: unknown, providerName: string, externalSignal?: AbortSignal): LLMError {
  if (e instanceof LLMError) return e;

  if (e instanceof Error && e.name === 'AbortError') {
    if (externalSignal?.aborted) {
      return new LLMError(`${providerName} call was cancelled`, false);
    }
    return new LLMError(`${providerName} call timed out`, true);
  }

  if (e instanceof TypeError) {
    return new LLMError(`${providerName} network error: ${e.message}`, true);
  }

  if (isAdapterError(e)) {
    if (e.status === 404) {
      return new LLMError(`Model not found (${providerName})`, false);
    }
    if (e.status >= 500) {
      return new LLMError(`${providerName} server error: ${e.message}`, true);
    }
    return new LLMError(`${providerName} error: ${e.message}`, false);
  }

  const message = e instanceof Error ? e.message : String(e);
  return new LLMError(`${providerName} error: ${message}`, false);
}

const openaiAdapters = new Map<string, ReturnType<typeof createOpenAIAdapter>>();

function getAdapter(provider: LLMProvider) {
  const config = PROVIDERS[provider];
  if (config.adapter === 'ollama') return ollamaAdapter;

  let adapter = openaiAdapters.get(provider);
  if (!adapter) {
    adapter = createOpenAIAdapter({ providerName: config.name });
    openaiAdapters.set(provider, adapter);
  }
  return adapter;
}

export function createClient(provider: LLMProvider): LLMClient {
  const config = PROVIDERS[provider];
  const adapter = getAdapter(provider);

  return {
    async generate(baseUrl, model, prompt, options?: LLMCallOptions): Promise<string> {
      const temperature = options?.temperature ?? 0;
      const maxTokens = options?.maxTokens;
      const stage = options?.stage ?? 'unknown';
      const fullPrompt = `${SYSTEM_PROMPT}\n\n${prompt}`;

      let lastError: LLMError | null = null;

      for (let attempt = 1; attempt <= 2; attempt++) {
        const { signal, cleanup } = createAbortSignal(
          options?.timeout ?? GENERATE_TIMEOUT_MS,
          options?.signal,
        );
        const startTime = Date.now();

        try {
          const result = await adapter.generate(baseUrl, model, fullPrompt, {
            temperature,
            maxTokens,
            signal,
            extra: options?.extra,
          });

          const latency = Date.now() - startTime;

          if (!result.text || result.text.trim().length === 0) {
            throw new LLMError(`LLM returned empty response [${stage}]`, false);
          }

          if (result.usage) {
            const total = result.usage.promptTokens + result.usage.completionTokens;
            debugLog(
              `[${config.name} ${stage}] Tokens: ${result.usage.promptTokens} + ${result.usage.completionTokens} = ${total}, Latency: ${latency}ms`,
            );
          }

          return result.text.trim();
        } catch (e: unknown) {
          const error = classifyError(e, config.name, options?.signal);

          if (options?.signal?.aborted) throw error;
          if (!error.retryable) throw error;
          if (attempt === 2) throw error;

          lastError = error;
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        } finally {
          cleanup();
        }
      }

      throw lastError ?? new LLMError('Unexpected retry loop exit', false);
    },

    async *chatStream(baseUrl, model, messages, options?: LLMCallOptions): AsyncIterable<ChatChunk> {
      const temperature = options?.temperature ?? 0.7;
      const { signal, cleanup } = createAbortSignal(
        options?.timeout ?? CHAT_STREAM_TIMEOUT_MS,
        options?.signal,
      );

      try {
        const stream = adapter.chatStream(baseUrl, model, messages, {
          temperature,
          maxTokens: options?.maxTokens,
          signal,
          extra: options?.extra,
        });

        for await (const chunk of stream) {
          yield chunk;
        }
      } catch (e: unknown) {
        throw classifyError(e, config.name, options?.signal);
      } finally {
        cleanup();
      }
    },

    async listModels(baseUrl: string): Promise<ModelInfo[]> {
      const { signal, cleanup } = createAbortSignal(5000);
      try {
        return await adapter.listModels(baseUrl, signal);
      } finally {
        cleanup();
      }
    },

    async checkStatus(baseUrl: string): Promise<StatusResult> {
      const { signal, cleanup } = createAbortSignal(5000);
      try {
        return await adapter.checkStatus(baseUrl, signal);
      } finally {
        cleanup();
      }
    },
  };
}
