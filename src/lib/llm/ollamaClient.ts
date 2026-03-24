/**
 * Ollama REST API client — server-side only (used in API routes).
 * Every function takes `baseUrl` so the caller controls which Ollama
 * instance is targeted (the user picks the URL in Settings).
 */

import { SYSTEM_PROMPT } from './prompts';
import { LLMCallOptions } from './types';
import { debugLog } from '@/lib/utils/debug';

const DEFAULT_URL = "http://localhost:11434";

/**
 * Error with retry classification.
 * retryable=true means safe to retry (timeout, network error).
 * retryable=false means don't retry (model not found, invalid prompt).
 */
export class OllamaGenerateError extends Error {
  constructor(
    message: string,
    public retryable: boolean
  ) {
    super(message);
    this.name = 'OllamaGenerateError';
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

export async function listModels(
  baseUrl: string = DEFAULT_URL,
): Promise<string[]> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models || []).map((m: { name: string }) => m.name);
  } catch {
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

  const modelOptions = { 
    temperature: typedOptions.temperature ?? 0,
    num_predict: typedOptions.maxTokens ?? 4096,
    num_ctx: 16384,
  };

  const controller = new AbortController();
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
        throw new OllamaGenerateError(`Model not found: ${model}`, false);
      } else if (res.status >= 500) {
        throw new OllamaGenerateError(`Ollama server error: ${text}`, true);
      } else {
        throw new OllamaGenerateError(`Ollama error: ${text}`, false);
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
      throw new OllamaGenerateError(`Ollama call timed out after 5 minutes`, true);
    }
    
    if (e instanceof OllamaGenerateError) {
      throw e;  // Already classified
    }
    
    // Network error - retryable
    const message = e instanceof Error ? e.message : 'Unknown error';
    throw new OllamaGenerateError(`Ollama network error: ${message}`, true);
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
