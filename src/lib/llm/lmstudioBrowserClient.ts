/**
 * Browser-side LM Studio client — calls LM Studio directly from the browser.
 *
 * LM Studio uses an OpenAI-compatible API with /v1/* endpoints.
 * When deployed (e.g. on Vercel), the Next.js API routes can't reach
 * localhost:1234 because LM Studio runs on the USER's machine, not on
 * the server. This client makes requests directly from the browser,
 * where "localhost" correctly refers to the user's machine.
 */
import { ModelInfo } from './types';
import { debugWarn } from '@/lib/utils/debug';

const GENERATE_TIMEOUT_MS = 3 * 60 * 1000;
const CHAT_CONNECT_TIMEOUT_MS = 30 * 1000;

/* ── Error handling helpers ───────────────────────────────── */

interface LMStudioErrorResponse {
  error?: {
    message?: string;
    type?: string;
  } | string;
}

/**
 * Parse LM Studio error response and return user-friendly message
 */
function parseLMStudioError(responseText: string, context: string): string {
  // Try to parse as JSON
  try {
    const parsed: LMStudioErrorResponse = JSON.parse(responseText);

    // Handle structured error
    if (parsed.error) {
      const msg = typeof parsed.error === 'string'
        ? parsed.error.toLowerCase()
        : parsed.error.message?.toLowerCase() || '';

      // Model loading errors
      if (msg.includes('failed to load model') || msg.includes('model not found')) {
        return `Model failed to load in LM Studio. Please ensure the model is downloaded and LM Studio is running. Try reloading the model in LM Studio.`;
      }

      // Model unloaded
      if (msg.includes('model is unloaded') || msg.includes('unloaded')) {
        return `The model was unloaded. Please reload it in LM Studio and try again.`;
      }

      // Return the original message if no special handling
      const displayMsg = typeof parsed.error === 'string'
        ? parsed.error
        : parsed.error.message || 'Unknown error';
      return `LM Studio error: ${displayMsg}`;
    }
  } catch {
    // Not JSON, check for plain text patterns
    const lower = responseText.toLowerCase();
    if (lower.includes('unloaded')) {
      return `The model was unloaded. Please reload it in LM Studio and try again.`;
    }
    if (lower.includes('failed to load')) {
      return `Model failed to load in LM Studio. Please ensure the model is downloaded and LM Studio is running.`;
    }
  }

  // Fallback
  return `LM Studio ${context} failed. Please check if LM Studio is running and the model is loaded.`;
}

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

export async function checkLMStudioStatus(
  baseUrl: string,
): Promise<{ connected: boolean; models: ModelInfo[]; selectedModel: string | null }> {
  try {
    const res = await fetch(`${baseUrl}/v1/models`, {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });

    if (!res.ok) {
      return { connected: false, models: [], selectedModel: null };
    }

    const data = await res.json();
    const models: ModelInfo[] = (data.data || []).map((m: { id: string; loaded_instances?: { config?: { context_length?: number } }[] }) => ({
      id: m.id,
      contextLength: m.loaded_instances?.[0]?.config?.context_length,
    }));
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
    const res = await fetch(`${baseUrl}/v1/models`, {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data || []).map((m: { id: string; loaded_instances?: { config?: { context_length?: number } }[] }) => ({
      id: m.id,
      contextLength: m.loaded_instances?.[0]?.config?.context_length,
    }));
  } catch (error) {
    debugWarn('LMStudioBrowser', 'listModels failed:', error);
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
  const requestOptions = { ...(options || {}) };
  const externalSignal = requestOptions.signal as AbortSignal | undefined;
  delete requestOptions.signal;
  const { signal, cleanup } = createAbortSignal(GENERATE_TIMEOUT_MS, externalSignal);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        stream: false,
        ...requestOptions,
      }),
    });
  } catch {
    cleanup();
    if (signal.aborted) {
      if (externalSignal?.aborted) {
        throw new Error('LM Studio request was cancelled.');
      }
      throw new Error('LM Studio request timed out.');
    }
    // Network error (LM Studio not running)
    throw new Error(`Cannot connect to LM Studio at ${baseUrl}. Please ensure LM Studio is running.`);
  }

  if (!res.ok) {
    cleanup();
    const text = await res.text().catch(() => res.statusText);
    throw new Error(parseLMStudioError(text, 'request'));
  }

  const data = await res.json();
  cleanup();
  // OpenAI format: { choices: [{ message: { content: "..." } }] }
  return data.choices?.[0]?.message?.content ?? "";
}

/* ── Chat (streaming, used for chat panel) ───────────────── */

export async function chatStream(
  baseUrl: string,
  model: string,
  messages: { role: string; content: string }[],
  options?: Record<string, unknown>,
): Promise<ReadableStream<Uint8Array>> {
  const requestOptions = { ...(options || {}) };
  const externalSignal = requestOptions.signal as AbortSignal | undefined;
  delete requestOptions.signal;
  const { signal, cleanup } = createAbortSignal(CHAT_CONNECT_TIMEOUT_MS, externalSignal);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        ...requestOptions,
      }),
    });
  } catch {
    cleanup();
    if (signal.aborted) {
      if (externalSignal?.aborted) {
        throw new Error('LM Studio chat was cancelled.');
      }
      throw new Error('LM Studio chat connection timed out.');
    }
    // Network error (LM Studio not running)
    throw new Error(`Cannot connect to LM Studio at ${baseUrl}. Please ensure LM Studio is running.`);
  }

  if (!res.ok) {
    cleanup();
    const text = await res.text().catch(() => res.statusText);
    throw new Error(parseLMStudioError(text, 'chat'));
  }

  cleanup();
  if (!res.body) throw new Error("No response body from LM Studio");
  return res.body;
}
