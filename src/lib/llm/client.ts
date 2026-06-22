import { LLMError } from './types';
import type {
  LLMCallOptions,
  LLMClient,
  LLMProvider,
  ChatChunk,
  ModelInfo,
  StatusResult,
} from './types';
import { PROVIDERS } from './types';
import { ollamaAdapter } from './ollamaAdapter';
import { createOpenAIAdapter } from './openaiAdapter';
import { debugLog, debugError } from '@/lib/utils/debug';

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

/**
 * Wrap a non-LLMError throw as an LLMError with a classified kind. An LLMError from the
 * adapter already carries a kind (assigned where the provider outcome was observed) and is
 * passed through unchanged. Spec §7: timeout/server-unreachable/server-error are transport-
 * retryable; everything else is terminal here (application retry is the retry engine's job).
 */
function classifyError(e: unknown, providerName: string, externalSignal?: AbortSignal): LLMError {
  if (e instanceof LLMError) return e;

  if (e instanceof Error && e.name === 'AbortError') {
    return externalSignal?.aborted
      ? new LLMError(`${providerName} call was cancelled`, 'cancelled')
      : new LLMError(`${providerName} call timed out`, 'timeout');
  }

  if (e instanceof TypeError) {
    return new LLMError(`${providerName} network error: ${e.message}`, 'server-unreachable');
  }

  const message = e instanceof Error ? e.message : String(e);
  return new LLMError(`${providerName} error: ${message}`, 'unknown');
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
    async generate(baseUrl, model, prompt, options: LLMCallOptions): Promise<string> {
      const temperature = options.temperature ?? 0;
      const stage = options.stage ?? 'unknown';
      let lastError: LLMError | null = null;

      for (let attempt = 1; attempt <= 2; attempt++) {
        const { signal, cleanup } = createAbortSignal(
          options.timeout ?? GENERATE_TIMEOUT_MS,
          options.signal,
        );
        const startTime = Date.now();

        try {
          // The surface owns no prompt content: the bare `prompt` (user content) and the
          // caller-supplied `systemPrompt` are forwarded separately — the adapter delivers
          // the system prompt as a system message (spec §10). No concatenation.
          const result = await adapter.generate(baseUrl, model, prompt, {
            temperature,
            topP: options.topP,
            maxOutputTokens: options.maxOutputTokens,
            contextWindow: options.contextWindow,
            responseFormat: options.responseFormat,
            responseSchema: options.responseSchema,
            schemaName: options.schemaName,
            systemPrompt: options.systemPrompt,
            signal,
          });

          const latency = Date.now() - startTime;

          if (!result.text || result.text.trim().length === 0) {
            debugError('LLMClient.generate', `Empty response [${stage}] model: ${model}`);
            throw new LLMError(`LLM returned empty response [${stage}] (model: ${model})`, 'unknown');
          }

          if (result.usage) {
            debugLog(
              `[${config.name} ${stage}] Tokens: ${result.usage.promptTokens} + ${result.usage.completionTokens}, Latency: ${latency}ms`,
            );
          }

          return result.text.trim();
        } catch (e: unknown) {
          const error = classifyError(e, config.name, options.signal);

          if (options.signal?.aborted) throw error;
          if (!error.retryable) throw error;
          if (attempt === 2) throw error;

          lastError = error;
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        } finally {
          cleanup();
        }
      }

      throw lastError ?? new LLMError('Unexpected retry loop exit', 'unknown');
    },

    async *chatStream(baseUrl, model, messages, options: LLMCallOptions): AsyncIterable<ChatChunk> {
      // Frozen (spec §12): chat temperature default 0.7; chat always passes 0.05.
      const temperature = options.temperature ?? 0.7;
      const { signal, cleanup } = createAbortSignal(
        options.timeout ?? CHAT_STREAM_TIMEOUT_MS,
        options.signal,
      );

      try {
        // No systemPrompt here — chat supplies its own system message inside `messages`;
        // the surface forwards the array unchanged (spec §10).
        const stream = adapter.chatStream(baseUrl, model, messages, {
          temperature,
          topP: options.topP,
          maxOutputTokens: options.maxOutputTokens,
          contextWindow: options.contextWindow,
          responseFormat: options.responseFormat,
          signal,
        });

        for await (const chunk of stream) {
          yield chunk;
        }
      } catch (e: unknown) {
        throw classifyError(e, config.name, options.signal);
      } finally {
        cleanup();
      }
    },

    async listModels(baseUrl: string, selectedModel?: string): Promise<ModelInfo[]> {
      const { signal, cleanup } = createAbortSignal(5000);
      try {
        return await adapter.listModels(baseUrl, signal, selectedModel);
      } finally {
        cleanup();
      }
    },

    async checkStatus(baseUrl: string, selectedModel?: string): Promise<StatusResult> {
      const { signal, cleanup } = createAbortSignal(5000);
      try {
        return await adapter.checkStatus(baseUrl, signal, selectedModel);
      } finally {
        cleanup();
      }
    },
  };
}
