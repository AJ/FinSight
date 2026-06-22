import type { TokenUsage, ChatChunk, LLMAdapter } from './types';
import { LLMError, type FailureKind } from './types';
import { ENFORCE_JSON_SCHEMA_ON_WIRE } from './types';
import { debugWarn, debugError } from '@/lib/utils/debug';

function statusToKind(status: number): FailureKind {
  if (status === 404) return 'model-missing';
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 500) return 'server-error';
  return 'request-rejected';
}

/**
 * Enforce the structured-output option pairing at the adapter boundary (spec §7). A plain
 * Error (not LLMError): these are programmer mistakes, not provider outcomes. The single
 * choke point both providers pass through catches a forgotten schema before it reaches the
 * network.
 */
function assertStructuredOptions(options: {
  responseFormat: 'json' | 'text';
  responseSchema?: unknown;
  schemaName?: string;
}): void {
  if (options.responseFormat === 'json' && !options.responseSchema) {
    throw new Error('responseFormat "json" requires responseSchema');
  }
  if (options.responseFormat === 'json' && !options.schemaName) {
    throw new Error('responseFormat "json" requires schemaName');
  }
  if (options.responseFormat === 'text' && options.responseSchema) {
    throw new Error('responseFormat "text" must not include responseSchema');
  }
}

/**
 * The provider's reply was a non-OK response. Derive a failure kind: start from
 * the HTTP status, then override to model-missing when the body says the model
 * is not loaded / not found / unloaded (these appear at various status codes).
 */
function classifyProviderError(responseText: string, status: number): FailureKind {
  let kind = statusToKind(status);
  const lower = responseText.toLowerCase();
  if (lower.includes('not found') || lower.includes('failed to load') || lower.includes('unloaded')) {
    kind = 'model-missing';
  }
  return kind;
}

function parseProviderError(responseText: string, providerName: string): string {
  try {
    const parsed = JSON.parse(responseText);
    if (parsed.error) {
      const msg = typeof parsed.error === 'string'
        ? parsed.error.toLowerCase()
        : parsed.error.message?.toLowerCase() || '';

      if (msg.includes('failed to load model') || msg.includes('model not found')) {
        return `Model failed to load in ${providerName}. Please ensure the model is downloaded and ${providerName} is running.`;
      }
      if (msg.includes('model is unloaded') || msg.includes('unloaded')) {
        return `The model was unloaded. Please reload it in ${providerName} and try again.`;
      }

      const displayMsg = typeof parsed.error === 'string'
        ? parsed.error
        : parsed.error.message || 'Unknown error';
      return `${providerName} error: ${displayMsg}`;
    }
  } catch {
    const lower = responseText.toLowerCase();
    if (lower.includes('unloaded')) {
      return `The model was unloaded. Please reload it in ${providerName} and try again.`;
    }
    if (lower.includes('failed to load')) {
      return `Model failed to load in ${providerName}. Please ensure the model is downloaded and ${providerName} is running.`;
    }
  }
  return `${providerName} request failed. Please check if ${providerName} is running and the model is loaded.`;
}

export interface OpenAIAdapterConfig {
  providerName: string;
}

interface OpenAIModelEntry {
  id: string;
  loaded_instances?: { config?: { context_length?: number } }[];
}

interface NativeLMStudioModelEntry {
  key?: string;
  id?: string;
  loaded_instances?: { config?: { context_length?: number } }[];
}

export function createOpenAIAdapter(config: OpenAIAdapterConfig): LLMAdapter {
  return {
    async generate(baseUrl, model, prompt, options) {
      assertStructuredOptions(options);
      // System prompt delivered as a real system-role message, not concatenated into the
      // user prompt (spec §8, bug 17).
      const messages: { role: string; content: string }[] = [];
      if (options.systemPrompt) {
        messages.push({ role: 'system', content: options.systemPrompt });
      }
      messages.push({ role: 'user', content: prompt });

      const body: Record<string, unknown> = {
        model,
        messages,
        stream: false,
        temperature: options.temperature,
      };
      if (options.maxOutputTokens !== undefined) {
        body.max_tokens = options.maxOutputTokens;
      }
      if (options.topP != null) {
        body.top_p = options.topP;
      }
      if (ENFORCE_JSON_SCHEMA_ON_WIRE && options.responseFormat === 'json') {
        body.response_format = {
          type: 'json_schema',
          json_schema: {
            name: options.schemaName,
            strict: false,
            schema: options.responseSchema,
          },
        };
      }

      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: options.signal,
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new LLMError(
          parseProviderError(text, config.providerName),
          classifyProviderError(text, res.status),
        );
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content ?? '';

      if (!text || text.trim().length === 0) {
        const choice = data.choices?.[0];
        debugError('OpenAIAdapter.generate', `Empty response from ${config.providerName}:\nModel: ${model},\nHTTP Status: ${res.status},\nRequest Messages: ${JSON.stringify((body.messages as { role: string; content: string }[] | undefined)?.map(m => ({ role: m.role, contentLength: m.content?.length ?? 0 })))},\nRequest Temperature: ${body.temperature},\nRequest Max Tokens: ${body.max_tokens ?? 'unset'},\nChoices Count: ${data.choices?.length ?? 0},\nFirst Choice Keys: ${choice ? Object.keys(choice).join(', ') : 'none'},\nMessage Keys: ${choice?.message ? Object.keys(choice.message).join(', ') : 'none'},\nContent Null: ${choice?.message?.content == null},\nFinish Reason: ${choice?.finish_reason ?? 'none'},\nUsage: ${data.usage ? `${data.usage.prompt_tokens}+${data.usage.completion_tokens}` : 'none'}`);
      }

      const usage: TokenUsage | undefined = data.usage
        ? { promptTokens: data.usage.prompt_tokens ?? 0, completionTokens: data.usage.completion_tokens ?? 0 }
        : undefined;

      return { text, usage };
    },

    async *chatStream(baseUrl, model, messages, options) {
      assertStructuredOptions(options);
      const body: Record<string, unknown> = {
        model,
        messages,
        stream: true,
        temperature: options.temperature,
      };
      if (options.maxOutputTokens !== undefined) {
        body.max_tokens = options.maxOutputTokens;
      }
      if (options.topP != null) {
        body.top_p = options.topP;
      }
      if (ENFORCE_JSON_SCHEMA_ON_WIRE && options.responseFormat === 'json') {
        body.response_format = {
          type: 'json_schema',
          json_schema: {
            name: options.schemaName,
            strict: false,
            schema: options.responseSchema,
          },
        };
      }

      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: options.signal,
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new LLMError(
          parseProviderError(text, config.providerName),
          classifyProviderError(text, res.status),
        );
      }
      if (!res.body) throw new Error(`No response body from ${config.providerName}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let lastUsage: TokenUsage | undefined;
      let sawDone = false;

      try {
        while (true) {
          const { done: readDone, value } = await reader.read();
          if (readDone) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;

            const data = trimmed.slice(6);
            if (data === '[DONE]') {
              // Attach the last-seen usage (bug 12) so a consumer reading the
              // terminal chunk still gets token counts.
              sawDone = true;
              yield { delta: '', done: true, usage: lastUsage } as ChatChunk;
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content ?? '';
              if (parsed.usage) {
                lastUsage = {
                  promptTokens: parsed.usage.prompt_tokens ?? 0,
                  completionTokens: parsed.usage.completion_tokens ?? 0,
                };
              }
              yield { delta, done: false, usage: lastUsage } as ChatChunk;
            } catch {
              // Skip malformed lines
            }
          }
        }
        // Stream ended without an explicit [DONE] (e.g. mid-stream disconnect on an
        // OpenAI-compatible server) — emit a synthetic terminal chunk (spec §8, bug 10).
        if (!sawDone) yield { delta: '', done: true, usage: lastUsage } as ChatChunk;
      } finally {
        reader.releaseLock();
      }
    },

    async listModels(baseUrl, signal) {
      // LM Studio's endpoints already return context_length natively, so the
      // selectedModel hint (3rd param on the interface) is not needed here and is
      // omitted — a narrower signature still satisfies LLMAdapter.listModels.
      // Try native LM Studio API for richer model info (context_length)
      try {
        const res = await fetch(`${baseUrl}/api/v1/models`, { signal, cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          const models = data.models || [];
          if (models.length > 0) {
            return models.map((m: NativeLMStudioModelEntry) => ({
              id: m.key || m.id,
              contextLength: m.loaded_instances?.[0]?.config?.context_length,
            }));
          }
        }
      } catch {
        // Fall through to OpenAI-compatible endpoint
      }

      // Fallback: OpenAI-compatible endpoint (model IDs only, no context_length)
      try {
        const res = await fetch(`${baseUrl}/v1/models`, { signal, cache: 'no-store' });
        if (!res.ok) return [];
        const data = await res.json();
        return (data.data || []).map((m: OpenAIModelEntry) => ({
          id: m.id,
          contextLength: m.loaded_instances?.[0]?.config?.context_length,
        }));
      } catch (error) {
        debugWarn(config.providerName, 'listModels failed:', error);
        return [];
      }
    },

    async checkStatus(baseUrl, signal) {
      try {
        const res = await fetch(`${baseUrl}/v1/models`, { signal, cache: 'no-store' });
        if (!res.ok) return { connected: false, models: [], selectedModel: null };

        const models = await this.listModels(baseUrl, signal);
        return { connected: true, models, selectedModel: models[0]?.id ?? null };
      } catch {
        return { connected: false, models: [], selectedModel: null };
      }
    },
  };
}
