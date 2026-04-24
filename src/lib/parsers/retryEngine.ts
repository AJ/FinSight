/**
 * Retry engine with failure context.
 *
 * Retries LLM calls with validation feedback injected into the prompt.
 * Each retry tells the LLM exactly what was wrong with its previous output.
 */

import { parseLLMJsonResponse } from '@/lib/utils/llm-response-parser';
import { callLLM } from '../llm/llmClient';
import type { LLMRuntimeConfig } from '../llm/types';
import { debugLog } from '@/lib/utils/debug';

export interface RetryConfig {
  maxRetries: number;
  stage: string;
  maxTokens?: number;
  onValidationFailure?: (parsed: unknown, errors: string[]) => void;
  signal?: AbortSignal;
  llmConfig: LLMRuntimeConfig;
}

export interface RetryResult<T> {
  success: boolean;
  data: T | null;
  errors: string[];
  warnings: string[];
  attempts: number;
  debugInfo?: unknown;
}

export interface ValidationResult<T> {
  valid: boolean;
  errors: string[];
  warnings: string[];
  data: T | null;
}

function buildRetryPrompt(
  basePrompt: string,
  previousOutput: string,
  errors: string[],
  attempt: number
): string {
  let strictnessInstruction = '';

  if (attempt === 2) {
    strictnessInstruction = 'Fix ALL errors listed above. Return ONLY valid JSON.';
  } else if (attempt >= 3) {
    strictnessInstruction = 'Return ONLY the minimal valid JSON structure. No extra fields. No text outside JSON.';
  } else {
    strictnessInstruction = 'Fix all errors and return valid JSON.';
  }

  return `${basePrompt}

---
PREVIOUS OUTPUT (INVALID):
${previousOutput}

---
VALIDATION ERRORS TO FIX:
${errors.map(e => `- ${e}`).join('\n')}

---
INSTRUCTIONS:
${strictnessInstruction}
Do not include explanations or markdown fences.`;
}

export async function runWithRetry<T>(
  basePrompt: string,
  normalizedText: string,
  validateFn: (data: unknown) => ValidationResult<T>,
  config: RetryConfig
): Promise<RetryResult<T>> {
  const errors: string[] = [];
  let lastRawOutput: string | null = null;
  let lastParsedData: T | null = null;
  let lastValidationWarnings: string[] = [];
  let lastDebugInfo: unknown;

  const callOptions = {
    stage: config.stage,
    maxTokens: config.maxTokens ?? 4096,
    signal: config.signal,
    runtime: config.llmConfig,
  };

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      const prompt = attempt === 1
        ? basePrompt.replace('{RAW_TEXT}', normalizedText)
        : buildRetryPrompt(basePrompt, lastRawOutput!, errors, attempt);

      if (attempt === 1 && (config.stage === 'cc_transactions' || config.stage === 'bank_transactions')) {
        debugLog(config.stage, 'Normalized text sent to LLM for transaction extraction:');
        debugLog(config.stage, normalizedText);
        debugLog(config.stage, '--- END NORMALIZED TEXT ---');
      }

      const rawResponse = await callLLM(prompt, callOptions);
      lastRawOutput = rawResponse;

      let parsed: T;
      try {
        parsed = parseLLMJsonResponse(rawResponse);
        lastParsedData = parsed;

        if (config.stage === 'cc_transactions' || config.stage === 'bank_transactions') {
          const anyParsed = parsed as Record<string, unknown> & { _debug?: unknown };
          debugLog(config.stage, 'Parsed transaction response keys:', Object.keys(anyParsed));
          if (anyParsed._debug) {
            debugLog(config.stage, 'Transaction extraction debug:', anyParsed._debug);
            lastDebugInfo = anyParsed._debug;
            delete anyParsed._debug;
          } else {
            debugLog(config.stage, 'No _debug field in response');
            lastDebugInfo = undefined;
          }
        }

        if (config.stage === 'cc_summary' && attempt === 1) {
          debugLog(config.stage, 'Raw LLM response:', rawResponse);
        }
      } catch (parseErr: unknown) {
        errors.length = 0;
        errors.push(`Invalid JSON: ${parseErr instanceof Error ? parseErr.message : 'Unknown error'}`);
        continue;
      }

      const validationResult = validateFn(parsed);

      if (validationResult.valid) {
        debugLog(config.stage, `Success on attempt ${attempt}`);
        if (config.stage === 'cc_summary' || config.stage === 'bank_summary') {
          debugLog(config.stage, 'Extracted summary:', validationResult.data);
        }
        if (config.stage === 'cc_transactions' || config.stage === 'bank_transactions') {
          debugLog(config.stage, 'Extracted transactions:', validationResult.data);
        }
        return {
          success: true,
          data: validationResult.data,
          errors: [],
          warnings: validationResult.warnings,
          attempts: attempt,
          debugInfo: lastDebugInfo,
        };
      }

      config.onValidationFailure?.(parsed, validationResult.errors);

      errors.length = 0;
      errors.push(...validationResult.errors);
      lastValidationWarnings = validationResult.warnings;

      debugLog(`[Retry Engine ${config.stage}] Attempt ${attempt} failed, retrying with failure context...`);
      debugLog(`[Retry Engine ${config.stage}] Errors:`, validationResult.errors);
    } catch (extractErr: unknown) {
      if (config.signal?.aborted) {
        throw extractErr;
      }
      errors.length = 0;
      errors.push(`LLM call failed: ${extractErr instanceof Error ? extractErr.message : 'Unknown error'}`);
    }
  }

  return {
    success: false,
    data: lastParsedData,
    errors,
    warnings: lastValidationWarnings,
    attempts: config.maxRetries,
    debugInfo: lastDebugInfo,
  };
}
