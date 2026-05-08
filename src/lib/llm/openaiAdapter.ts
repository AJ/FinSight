import type { ModelInfo, TokenUsage, ChatChunk, LLMAdapter } from './types';
import { createAdapterError } from './types';
import { debugWarn } from '@/lib/utils/debug';

function throwWithStatus(message: string, status: number): never {
  throw createAdapterError(message, status);
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

export function createOpenAIAdapter(config: OpenAIAdapterConfig): LLMAdapter {
  return {
    async generate(baseUrl, model, prompt, options) {
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: options.signal,
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          stream: false,
          temperature: options.temperature,
          max_tokens: options.maxTokens ?? 4096,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throwWithStatus(parseProviderError(text, config.providerName), res.status);
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content ?? '';
      const usage: TokenUsage | undefined = data.usage
        ? { promptTokens: data.usage.prompt_tokens ?? 0, completionTokens: data.usage.completion_tokens ?? 0 }
        : undefined;

      return { text, usage };
    },

    async *chatStream(baseUrl, model, messages, options) {
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: options.signal,
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          temperature: options.temperature,
          max_tokens: options.maxTokens ?? 4096,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throwWithStatus(parseProviderError(text, config.providerName), res.status);
      }
      if (!res.body) throw new Error(`No response body from ${config.providerName}`);

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
            if (!trimmed || !trimmed.startsWith('data: ')) continue;

            const data = trimmed.slice(6);
            if (data === '[DONE]') {
              yield { delta: '', done: true, usage: undefined } as ChatChunk;
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content ?? '';
              yield { delta, done: false, usage: undefined } as ChatChunk;
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

        const data = await res.json();
        const models: ModelInfo[] = (data.data || []).map((m: OpenAIModelEntry) => ({
          id: m.id,
          contextLength: m.loaded_instances?.[0]?.config?.context_length,
        }));

        return { connected: true, models, selectedModel: models[0]?.id ?? null };
      } catch {
        return { connected: false, models: [], selectedModel: null };
      }
    },
  };
}
