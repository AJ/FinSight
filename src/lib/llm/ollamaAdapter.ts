import type {
  ModelInfo,
  TokenUsage,
  ChatChunk,
  LLMAdapter,
} from './types';
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

function parseNumCtx(parameters: string | undefined): number | undefined {
  if (!parameters) return undefined;
  const match = parameters.match(/num_ctx\s+(\d+)/);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

function parseArchContextLength(
  modelInfo: Record<string, unknown> | undefined,
): number | undefined {
  if (!modelInfo) return undefined;
  for (const [key, value] of Object.entries(modelInfo)) {
    if (key.endsWith('.context_length') && typeof value === 'number')
      return value;
  }
  return undefined;
}

async function fetchModelContextLength(
  baseUrl: string,
  modelName: string,
  signal: AbortSignal,
): Promise<number | undefined> {
  try {
    const res = await fetch(`${baseUrl}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName }),
      signal,
    });
    if (!res.ok) return undefined;
    const data = await res.json();
    return (
      parseNumCtx(data.parameters) ?? parseArchContextLength(data.model_info)
    );
  } catch {
    return undefined;
  }
}

export const ollamaAdapter: LLMAdapter = {
  async generate(baseUrl, model, prompt, options) {
    assertStructuredOptions(options);
    const ollamaOptions: Record<string, unknown> = {
      temperature: options.temperature,
    };
    if (options.contextWindow) {
      ollamaOptions.num_ctx = options.contextWindow;
    }
    if (options.topP != null) {
      ollamaOptions.top_p = options.topP;
    }
    if (options.maxOutputTokens !== undefined) {
      ollamaOptions.num_predict = options.maxOutputTokens;
    }

    const body: Record<string, unknown> = {
      model,
      prompt,
      stream: false,
      keep_alive: '10m',
      options: ollamaOptions,
    };
    if (ENFORCE_JSON_SCHEMA_ON_WIRE && options.responseFormat === 'json') {
      body.format = options.responseSchema;
    }
    // System prompt delivered as a real system message (Ollama `system` field), not
    // concatenated into the user prompt (spec §8, bug 17).
    if (options.systemPrompt) {
      body.system = options.systemPrompt;
    }

    const res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: options.signal,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new LLMError(`Ollama generate error: ${text}`, statusToKind(res.status));
    }

    const data = await res.json();
    const text = data.response ?? '';

    if (!text || text.trim().length === 0) {
      debugError('OllamaAdapter.generate', `Empty response from Ollama:\nModel: ${model},\nDone: ${data.done},\nEval Count: ${data.eval_count ?? 'none'},\nPrompt Eval Count: ${data.prompt_eval_count ?? 'none'},\nTotal Duration: ${data.total_duration ?? 'none'},\nLoad Duration: ${data.load_duration ?? 'none'},\nContext Length: ${data.context?.length ?? 'none'},\nResponse Keys: ${Object.keys(data).join(', ')}`);
    }

    const usage: TokenUsage | undefined =
      data.prompt_eval_count != null
        ? {
            promptTokens: data.prompt_eval_count,
            completionTokens: data.eval_count ?? 0,
          }
        : undefined;

    return { text, usage };
  },

  async *chatStream(baseUrl, model, messages, options) {
    assertStructuredOptions(options);
    const ollamaOptions: Record<string, unknown> = {
      temperature: options.temperature,
    };
    if (options.contextWindow) {
      ollamaOptions.num_ctx = options.contextWindow;
    }
    if (options.topP != null) {
      ollamaOptions.top_p = options.topP;
    }
    if (options.maxOutputTokens !== undefined) {
      ollamaOptions.num_predict = options.maxOutputTokens;
    }

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: options.signal,
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        keep_alive: '10m',
        options: ollamaOptions,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new LLMError(`Ollama chat error: ${text}`, statusToKind(res.status));
    }
    if (!res.body) throw new Error('No response body from Ollama');

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
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            const delta = parsed.message?.content ?? '';
            const isDone = parsed.done === true;
            if (isDone && parsed.eval_count != null) {
              lastUsage = {
                promptTokens: parsed.prompt_eval_count ?? 0,
                completionTokens: parsed.eval_count ?? 0,
              };
            }
            yield { delta, done: isDone, usage: isDone ? lastUsage : undefined } as ChatChunk;
            if (isDone) {
              sawDone = true;
              return;
            }
          } catch {
            // Skip malformed lines
          }
        }
      }
      // Stream ended without an explicit done frame — emit a synthetic terminal
      // chunk so consumers always see a `done: true` (bug 10).
      if (!sawDone) yield { delta: '', done: true, usage: lastUsage } as ChatChunk;
    } finally {
      reader.releaseLock();
    }
  },

  async listModels(baseUrl, signal, selectedModel) {
    try {
      const res = await fetch(`${baseUrl}/api/tags`, {
        signal,
        cache: 'no-store',
      });
      if (!res.ok) return [];
      const data = await res.json();
      const names: string[] = (data.models || []).map(
        (m: { name: string }) => m.name,
      );

      const results: ModelInfo[] = names.map((name) => ({ id: name }));

      // Enrich only the selected model on demand (one /api/show call), not the
      // whole list. Fixes the first-5-only coverage cliff.
      if (selectedModel) {
        const idx = results.findIndex((m) => m.id === selectedModel);
        if (idx >= 0) {
          const contextLength = await fetchModelContextLength(
            baseUrl,
            selectedModel,
            signal,
          );
          if (contextLength !== undefined)
            results[idx] = { id: selectedModel, contextLength };
        }
      }
      return results;
    } catch (error) {
      debugWarn('OllamaAdapter', 'listModels failed:', error);
      return [];
    }
  },

  async checkStatus(baseUrl, signal, selectedModel) {
    // Hit /api/tags (the model API), not the bare baseUrl — a 200 here genuinely
    // means the model API is reachable.
    try {
      const res = await fetch(`${baseUrl}/api/tags`, {
        signal,
        cache: 'no-store',
      });
      if (!res.ok)
        return { connected: false, models: [], selectedModel: null };
      const models = await this.listModels(baseUrl, signal, selectedModel);
      return {
        connected: true,
        models,
        selectedModel: models[0]?.id ?? null,
      };
    } catch {
      return { connected: false, models: [], selectedModel: null };
    }
  },
};
