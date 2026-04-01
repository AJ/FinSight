// src/lib/llm/llmClient.ts

import { LLMCallOptions } from './types';
import { generate as generateOllama } from './ollamaClient';
import { generate as generateLMStudio } from './lmstudioClient';
import { useSettingsStore } from '@/lib/store/settingsStore';

export type { LLMCallOptions };

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
  options: Omit<LLMCallOptions, 'temperature'> = {}
): Promise<string> {
  const { stage = 'unknown', maxTokens = 4096, signal } = options;
  
  // TEMPERATURE HARD CODED TO 0 - NON-NEGOTIABLE FOR DETERMINISTIC OUTPUT
  const temperature = 0;

  // Get user's LLM settings
  const settings = useSettingsStore.getState();
  const provider = settings.llmProvider;
  const baseUrl = settings.llmServerUrl;  // Single URL field for all providers
  const model = settings.llmModel;

  // Throw if no model configured - caller should handle fallback
  if (!model) {
    throw new Error(`LLM model not configured. Provider: ${provider}, URL: ${baseUrl}`);
  }

  // Network-level retry (1-2 attempts for transient failures only)
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      // Call appropriate provider
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

      // Validate response is non-empty
      if (!raw || typeof raw !== 'string' || raw.trim().length === 0) {
        throw new Error(`LLM returned empty response [${stage}]`);
      }

      // Return raw string — JSON parsing happens in runWithRetry
      return raw.trim();

    } catch (e: unknown) {
      lastError = e instanceof Error ? e : new Error(String(e));

      if (signal?.aborted) {
        throw e;
      }

      // Check if error is retryable
      const isRetryable = 
        (e instanceof Error && e.name === 'AbortError') ||
        (e instanceof Error && (
          e.message.includes('timed out') ||
          e.message.includes('network') ||
          e.message.includes('server error')
        ));

      // Don't retry on non-retryable errors
      if (!isRetryable) {
        throw e;
      }

      // Don't retry on last attempt
      if (attempt === 2) {
        throw e;
      }

      // Exponential backoff: 1s, then 2s
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }

  // Should never reach here — loop always throws or returns
  throw lastError!;
}
