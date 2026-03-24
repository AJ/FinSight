/**
 * LM Studio REST API client — server-side only (used in API routes).
 * LM Studio uses an OpenAI-compatible API (/v1/* endpoints).
 */

import { SYSTEM_PROMPT } from './prompts';
import { LLMCallOptions } from './types';
import { debugLog } from '@/lib/utils/debug';

const DEFAULT_URL = "http://localhost:1234";

/**
 * Error with retry classification.
 * retryable=true means safe to retry (timeout, network error).
 * retryable=false means don't retry (model not found, invalid prompt).
 */
export class LMStudioError extends Error {
  constructor(
    message: string,
    public retryable: boolean
  ) {
    super(message);
    this.name = 'LMStudioError';
  }
}

export async function checkLMStudioRunning(
  baseUrl: string = DEFAULT_URL,
): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/v1/models`, {
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
    const res = await fetch(`${baseUrl}/v1/models`, {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json();
    // OpenAI format: { data: [{ id: "model-name" }] }
    return (data.data || []).map((m: { id: string }) => m.id);
  } catch {
    return [];
  }
}

/**
 * Generate text using LM Studio.
 * 
 * @param baseUrl - LM Studio instance URL
 * @param model - Model name
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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15 * 60 * 1000); // 15 minutes

  const startTime = Date.now();

  try {
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: fullPrompt }
    ];

    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        temperature: typedOptions.temperature ?? 0,
        max_tokens: typedOptions.maxTokens ?? 4096,
      }),
    });

    clearTimeout(timeoutId);

    const latency = Date.now() - startTime;

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      
      // Classify error for retry decision
      if (res.status === 404) {
        throw new LMStudioError(`Model not found: ${model}`, false);
      } else if (res.status >= 500) {
        throw new LMStudioError(`LM Studio server error: ${text}`, true);
      } else {
        throw new LMStudioError(`LM Studio error: ${text}`, false);
      }
    }

    const data = await res.json();
    // OpenAI format: { choices: [{ message: { content: "..." } }] }
    const response = data.choices?.[0]?.message?.content ?? "";

    // Log telemetry (tokens + latency)
    const promptTokens = data.usage?.prompt_tokens ?? 0;
    const completionTokens = data.usage?.completion_tokens ?? 0;
    const totalTokens = promptTokens + completionTokens;
    
    debugLog(
      `[LM Studio ${typedOptions.stage ?? 'unknown'}] ` +
      `Tokens: ${promptTokens} + ${completionTokens} = ${totalTokens}, ` +
      `Latency: ${latency}ms`
    );

    return response;

  } catch (e: unknown) {
    clearTimeout(timeoutId);
    
    if (e instanceof Error && e.name === 'AbortError') {
      throw new LMStudioError(`LM Studio call timed out after 15 minutes`, true);
    }
    
    if (e instanceof LMStudioError) {
      throw e;  // Already classified
    }
    
    // Network error - retryable
    const message = e instanceof Error ? e.message : 'Unknown error';
    throw new LMStudioError(`LM Studio network error: ${message}`, true);
  }
}

export async function chatStream(
  baseUrl: string = DEFAULT_URL,
  model: string,
  messages: { role: string; content: string }[],
  options?: Record<string, unknown>,
): Promise<ReadableStream<Uint8Array>> {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.max_tokens ?? 4096,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`LM Studio chat error: ${text}`);
  }

  if (!res.body) throw new Error("No response body from LM Studio");
  return res.body;
}
