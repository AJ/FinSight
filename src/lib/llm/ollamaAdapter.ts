import type {
  ModelInfo,
  TokenUsage,
  ChatChunk,
  LLMAdapter,
} from './types';
import { createAdapterError } from './types';
import { debugWarn, debugError } from '@/lib/utils/debug';

interface OllamaExtra {
  num_ctx?: number;
  keep_alive?: string;
  top_p?: number;
}

function extractOllamaExtra(extra: Record<string, unknown> | undefined): OllamaExtra {
  if (!extra) return {};
  return {
    num_ctx: typeof extra.num_ctx === 'number' ? extra.num_ctx : undefined,
    keep_alive: typeof extra.keep_alive === 'string' ? extra.keep_alive : undefined,
    top_p: typeof extra.top_p === 'number' ? extra.top_p : undefined,
  };
}

function throwWithStatus(message: string, status: number): never {
  throw createAdapterError(message, status);
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
    const { num_ctx: numCtx = 8192, keep_alive: keepAlive = '10m', top_p: topP } = extractOllamaExtra(options.extra);

    const ollamaOptions: Record<string, unknown> = {
      num_ctx: numCtx,
      temperature: options.temperature,
      ...(topP != null ? { top_p: topP } : {}),
    };
    if (options.maxTokens !== undefined) {
      ollamaOptions.num_predict = options.maxTokens;
    }

    const res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: options.signal,
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        format: 'json',
        keep_alive: keepAlive,
        options: ollamaOptions,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throwWithStatus(`Ollama generate error: ${text}`, res.status);
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
    const { num_ctx: numCtx = 8192, keep_alive: keepAlive = '10m', top_p: topP } = extractOllamaExtra(options.extra);

    const ollamaOptions: Record<string, unknown> = {
      num_ctx: numCtx,
      temperature: options.temperature,
      ...(topP != null ? { top_p: topP } : {}),
    };
    if (options.maxTokens !== undefined) {
      ollamaOptions.num_predict = options.maxTokens;
    }

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: options.signal,
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        keep_alive: keepAlive,
        options: ollamaOptions,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throwWithStatus(`Ollama chat error: ${text}`, res.status);
    }
    if (!res.body) throw new Error('No response body from Ollama');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

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
            yield { delta, done: isDone, usage: undefined } as ChatChunk;
            if (isDone) return;
          } catch {
            // Skip malformed lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  },

  async listModels(baseUrl, signal) {
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

      const results: ModelInfo[] = [];
      const batch = names.slice(0, 5);
      const enriched = await Promise.all(
        batch.map(async (name) => {
          const contextLength = await fetchModelContextLength(
            baseUrl,
            name,
            signal,
          );
          return { id: name, contextLength };
        }),
      );
      results.push(...enriched);

      for (const name of names.slice(5)) {
        results.push({ id: name });
      }
      return results;
    } catch (error) {
      debugWarn('OllamaAdapter', 'listModels failed:', error);
      return [];
    }
  },

  async checkStatus(baseUrl, signal) {
    try {
      const res = await fetch(baseUrl, { signal, cache: 'no-store' });
      if (!res.ok)
        return { connected: false, models: [], selectedModel: null };
      const models = await this.listModels(baseUrl, signal);
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
