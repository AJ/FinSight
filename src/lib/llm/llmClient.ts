// src/lib/llm/llmClient.ts

import { LLMCallOptions } from './types';
import { generate as generateOllama } from './ollamaClient';
import { generate as generateLMStudio } from './lmstudioClient';

export type { LLMCallOptions };

function hasRetryable(e: Error): e is Error & { retryable: boolean } {
  return 'retryable' in e;
}

/**
 * Call LLM with retry logic for transient network failures.
 *
 * This function handles NETWORK-LEVEL retries only (timeouts, connection drops).
 * Validation-driven retries (invalid JSON, missing fields) are handled in runWithRetry.
 *
 * TEMPERATURE IS HARDCODED TO 0 FOR DETERMINISTIC OUTPUT.
 * Do NOT modify this unless you understand the impact on retry logic.
 *
 * @param prompt - The user prompt to send to the LLM
 * @param options - Call options (maxTokens, stage)
 * @returns Raw string response from LLM (not parsed)
 * @throws Error on failure (network errors are retryable)
 */
export async function callLLM(
  prompt: string,
  options: Omit<LLMCallOptions, 'temperature' | 'runtime'> & { runtime: NonNullable<LLMCallOptions['runtime']> }
): Promise<string> {
  const { stage = 'unknown', maxTokens = 4096, signal, runtime } = options;

  // TEMPERATURE HARD CODED TO 0 - NON-NEGOTIABLE FOR DETERMINISTIC OUTPUT
  const temperature = 0;

  const provider = runtime.provider;
  const baseUrl = runtime.baseUrl;
  const model = runtime.model;

  if (!provider || !baseUrl || !model) {
    throw new Error(`LLM model not configured. Provider: ${provider ?? 'unknown'}, URL: ${baseUrl ?? 'unknown'}`);
  }

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      let raw: string;

      if (provider === 'ollama') {
        raw = await generateOllama(baseUrl, model, prompt, {
          temperature,
          max_tokens: maxTokens,
          signal,
        });
      } else if (provider === 'lmstudio') {
        raw = await generateLMStudio(baseUrl, model, prompt, {
          temperature,
          max_tokens: maxTokens,
          signal,
        });
      } else {
        throw new Error(`Unsupported LLM provider: ${provider}`);
      }

      if (!raw || typeof raw !== 'string' || raw.trim().length === 0) {
        throw new Error(`LLM returned empty response [${stage}]`);
      }

      return raw.trim();
    } catch (e: unknown) {
      lastError = e instanceof Error ? e : new Error(String(e));

      if (signal?.aborted) {
        throw e;
      }

      const isRetryable =
        (e instanceof Error && hasRetryable(e) && e.retryable === true) ||
        (e instanceof Error && e.name === 'AbortError');

      if (!isRetryable) {
        throw e;
      }

      if (attempt === 2) {
        throw e;
      }

      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }

  throw lastError!;
}
