/**
 * Ollama REST API client — server-side only (used in API routes).
 * Every function takes `baseUrl` so the caller controls which Ollama
 * instance is targeted (the user picks the URL in Settings).
 */

import { SYSTEM_PROMPT } from './prompts';
import { LLMCallOptions, DEFAULT_URLS, ModelInfo } from './types';
import { debugLog, debugWarn } from '@/lib/utils/debug';

const DEFAULT_URL = DEFAULT_URLS.ollama;

/**
 * Error with retry classification.
 * retryable=true means safe to retry (timeout, network error).
 * retryable=false means don't retry (model not found, invalid prompt).
 */
export class OllamaError extends Error {
  constructor(
    message: string,
    public retryable: boolean
  ) {
    super(message);
    this.name = 'OllamaError';
  }
}

export async function checkOllamaRunning(
  baseUrl: string = DEFAULT_URL,
): Promise<boolean> {
  try {
    const res = await fetch(baseUrl, {
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

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

export async function listModels(
  baseUrl: string = DEFAULT_URL,
): Promise<ModelInfo[]> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json();
    const names: string[] = (data.models || []).map((m: { name: string }) => m.name);
    const batch = names.slice(0, 5);
    const results: ModelInfo[] = await Promise.all(
      batch.map(async (name) => {
        const contextLength = await fetchModelContextLength(baseUrl, name);
        return { id: name, contextLength };
      }),
    );
    for (const name of names.slice(5)) {
      results.push({ id: name });
    }
    return results;
  } catch (error) {
    debugWarn('OllamaServer', 'listModels failed:', error);
    return [];
  }
}

/**
 * Generate text using Ollama.
 * 
 * @param baseUrl - Ollama instance URL
 * @param model - Model name (e.g., "qwen2.5:4b")
 * @param prompt - User prompt
 * @param options - Generation options (temperature, maxTokens, stage for logging)
 * @returns Raw string response (not parsed)
 */
export async function generate(
  baseUrl: string = DEFAULT_URL,
  model: string,
  prompt: string,
  options?: Record<string, unknown>,
): Promise<string> {
  // Convert old options to new typed format
  const typedOptions: LLMCallOptions = {
    temperature: options?.temperature as number | undefined,
    maxTokens: options?.max_tokens as number | undefined,
    stage: undefined,
  };

  // Inject system prompt (centralized, not passed by caller)
  const fullPrompt = `${SYSTEM_PROMPT}\n\n${prompt}`;
  const externalSignal = options?.signal as AbortSignal | undefined;

  const modelOptions = { 
    temperature: typedOptions.temperature ?? 0,
    num_predict: typedOptions.maxTokens ?? 4096,
    num_ctx: 16384,
  };

  const controller = new AbortController();
  const abortFromExternal = () => controller.abort(externalSignal?.reason);
  if (externalSignal) {
    if (externalSignal.aborted) {
      abortFromExternal();
    } else {
      externalSignal.addEventListener('abort', abortFromExternal, { once: true });
    }
  }
  const timeoutId = setTimeout(() => controller.abort(), 15 * 60 * 1000); // 15 minutes

  const startTime = Date.now();

  try {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        prompt: fullPrompt,
        system: SYSTEM_PROMPT,  // Include both - model uses whichever it supports
        stream: false,
        format: "json",
        options: modelOptions,
      }),
    });

    clearTimeout(timeoutId);

    const latency = Date.now() - startTime;

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      
      // Classify error for retry decision
      if (res.status === 404) {
        throw new OllamaError(`Model not found: ${model}`, false);
      } else if (res.status >= 500) {
        throw new OllamaError(`Ollama server error: ${text}`, true);
      } else {
        throw new OllamaError(`Ollama error: ${text}`, false);
      }
    }

    const data = await res.json();
    const response = data.response ?? "";

    // Log telemetry (tokens + latency)
    const promptTokens = data.prompt_eval_count ?? 0;
    const completionTokens = data.eval_count ?? 0;
    const totalTokens = promptTokens + completionTokens;
    
    debugLog(
      `[Ollama ${typedOptions.stage ?? 'unknown'}] ` +
      `Tokens: ${promptTokens} + ${completionTokens} = ${totalTokens}, ` +
      `Latency: ${latency}ms`
    );

    return response;

  } catch (e: unknown) {
    clearTimeout(timeoutId);
    
    if (e instanceof Error && e.name === 'AbortError') {
      if (externalSignal?.aborted) {
        throw new OllamaError(`Ollama call was cancelled`, false);
      }
      throw new OllamaError(`Ollama call timed out after 15 minutes`, true);
    }
    
    if (e instanceof OllamaError) {
      throw e;  // Already classified
    }
    
    // Network error - retryable
    const message = e instanceof Error ? e.message : 'Unknown error';
    throw new OllamaError(`Ollama network error: ${message}`, true);
  } finally {
    if (externalSignal) {
      externalSignal.removeEventListener('abort', abortFromExternal);
    }
  }
}

export async function chatStream(
  baseUrl: string = DEFAULT_URL,
  model: string,
  messages: { role: string; content: string }[],
  options?: Record<string, unknown>,
): Promise<ReadableStream<Uint8Array>> {
  const modelOptions = { ...(options || {}) };
  const keepAlive = typeof modelOptions.keep_alive === 'string' ? String(modelOptions.keep_alive) : '10m';
  delete modelOptions.keep_alive;

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      keep_alive: keepAlive,
      options: {
        num_ctx: 8192,
        temperature: 0.05,
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
}
