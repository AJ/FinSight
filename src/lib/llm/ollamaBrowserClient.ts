/**
 * Browser-side Ollama client — calls Ollama directly from the browser.
 *
 * When deployed (e.g. on Vercel), the Next.js API routes can't reach
 * localhost:11434 because Ollama runs on the USER's machine, not on
 * the server. This client makes requests directly from the browser,
 * where "localhost" correctly refers to the user's machine.
 */
import { ModelInfo } from './types';
import { debugWarn } from '@/lib/utils/debug';

const GENERATE_TIMEOUT_MS = 3 * 60 * 1000;
const CHAT_CONNECT_TIMEOUT_MS = 30 * 1000;

function createAbortSignal(
  timeoutMs: number,
  externalSignal?: AbortSignal
): {
  signal: AbortSignal;
  cleanup: () => void;
} {
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

/* ── Connection check ────────────────────────────────────── */

function parseNumCtx(parameters: string | undefined): number | undefined {
  if (!parameters) return undefined;
  const match = parameters.match(/num_ctx\s+(\d+)/);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

function parseArchContextLength(modelInfo: Record<string, unknown> | undefined): number | undefined {
  if (!modelInfo) return undefined;
  for (const [key, value] of Object.entries(modelInfo)) {
    if (key.endsWith('.context_length') && typeof value === 'number') return value;
  }
  return undefined;
}

async function fetchModelContextLength(baseUrl: string, modelName: string): Promise<number | undefined> {
  try {
    const res = await fetch(`${baseUrl}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return undefined;
    const data = await res.json();
    return parseNumCtx(data.parameters) ?? parseArchContextLength(data.model_info);
  } catch {
    return undefined;
  }
}

async function enrichModelsWithContext(baseUrl: string, names: string[]): Promise<ModelInfo[]> {
  const batch = names.slice(0, 5);
  const results: ModelInfo[] = await Promise.all(
    batch.map(async (name) => {
      const contextLength = await fetchModelContextLength(baseUrl, name);
      return { id: name, contextLength };
    }),
  );
  // Add remaining models without context length (skip /api/show to avoid latency)
  for (const name of names.slice(5)) {
    results.push({ id: name });
  }
  return results;
}

export async function checkOllamaStatus(
  baseUrl: string,
): Promise<{ connected: boolean; models: ModelInfo[]; selectedModel: string | null }> {
  try {
    const res = await fetch(baseUrl, {
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    if (!res.ok) return { connected: false, models: [], selectedModel: null };

    const models = await listModels(baseUrl);
    return {
      connected: true,
      models,
      selectedModel: models[0]?.id ?? null,
    };
  } catch {
    return { connected: false, models: [], selectedModel: null };
  }
}

export async function listModels(baseUrl: string): Promise<ModelInfo[]> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json();
    const names: string[] = (data.models || []).map((m: { name: string }) => m.name);
    return enrichModelsWithContext(baseUrl, names);
  } catch (error) {
    debugWarn('OllamaBrowser', 'listModels failed:', error);
    return [];
  }
}

/* ── Generate (non-streaming, used for parsing) ──────────── */

export async function generate(
  baseUrl: string,
  model: string,
  prompt: string,
  options?: Record<string, unknown>,
): Promise<string> {
  const modelOptions = { ...(options || {}) };
  const externalSignal = modelOptions.signal as AbortSignal | undefined;
  const keepAlive = typeof modelOptions.keep_alive === 'string' ? String(modelOptions.keep_alive) : '10m';
  delete modelOptions.keep_alive;
  delete modelOptions.signal;

  const { signal, cleanup } = createAbortSignal(GENERATE_TIMEOUT_MS, externalSignal);

  try {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        format: "json",
        keep_alive: keepAlive,
        options: {
          num_ctx: 16384,
          temperature: 0.05,
          ...modelOptions,
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Ollama generate error: ${text}`);
    }

    const data = await res.json();
    return data.response;
  } catch (error) {
    if (signal.aborted) {
      if (externalSignal?.aborted) {
        throw new Error('Ollama request was cancelled.');
      }
      throw new Error('Ollama request timed out.');
    }
    throw error;
  } finally {
    cleanup();
  }
}

/* ── Chat (streaming, used for chat panel) ───────────────── */

export async function chatStream(
  baseUrl: string,
  model: string,
  messages: { role: string; content: string }[],
  options?: Record<string, unknown>,
): Promise<ReadableStream<Uint8Array>> {
  const modelOptions = { ...(options || {}) };
  const externalSignal = modelOptions.signal as AbortSignal | undefined;
  const keepAlive = typeof modelOptions.keep_alive === 'string' ? String(modelOptions.keep_alive) : '10m';
  delete modelOptions.keep_alive;
  delete modelOptions.signal;

  const { signal, cleanup } = createAbortSignal(CHAT_CONNECT_TIMEOUT_MS, externalSignal);

  try {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        keep_alive: keepAlive,
        options: {
          num_ctx: 8192,
          temperature: 0.7,
          ...modelOptions,
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Ollama chat error: ${text}`);
    }

    if (!res.body) throw new Error("No response body from Ollama");
    return res.body;
  } catch (error) {
    if (signal.aborted) {
      if (externalSignal?.aborted) {
        throw new Error('Ollama chat was cancelled.');
      }
      throw new Error('Ollama chat connection timed out.');
    }
    throw error;
  } finally {
    cleanup();
  }
}
