/**
 * Retry engine with failure context.
 *
 * Retries LLM calls with validation feedback injected into the prompt.
 * Each retry tells the LLM exactly what was wrong with its previous output.
 */

import { parseLLMJsonResponse } from '@/lib/utils/llm-response-parser';
import { callLLM } from '../llm/llmClient';
import { debugLog } from '@/lib/utils/debug';

export interface RetryConfig {
  maxRetries: number;
  stage: string;
  maxTokens?: number;
  onValidationFailure?: (parsed: unknown, errors: string[]) => void;
  signal?: AbortSignal;
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

/**
 * Build retry prompt with failure context and progressive strictness.
 */
function buildRetryPrompt(
  basePrompt: string,
  previousOutput: string,
  errors: string[],
  attempt: number
): string {
  // Progressive strictness based on attempt number
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

/**
 * Run LLM extraction with retry logic and failure context.
 *
 * @param basePrompt - The base prompt template (with {RAW_TEXT} placeholder)
 * @param normalizedText - The normalized statement text
 * @param validateFn - Validation function
 * @param config - Retry configuration
 */
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
    // temperature is hardcoded to 0 in callLLM - do not override
  };

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      // Build prompt (with failure context for retries)
      const prompt = attempt === 1
        ? basePrompt.replace('{RAW_TEXT}', normalizedText)
        : buildRetryPrompt(basePrompt, lastRawOutput!, errors, attempt);

      // Log the normalized text sent to LLM (for debugging)
      if (attempt === 1 && (config.stage === 'cc_transactions' || config.stage === 'bank_transactions')) {
        debugLog(config.stage, 'Normalized text sent to LLM for transaction extraction:');
        debugLog(config.stage, normalizedText);
        debugLog(config.stage, '--- END NORMALIZED TEXT ---');
      }

      const rawResponse = await callLLM(prompt, callOptions);
      lastRawOutput = rawResponse;

      // Parse JSON
      let parsed: T;
      try {
        parsed = parseLLMJsonResponse(rawResponse);
        lastParsedData = parsed;

        // Log dropped transactions for debugging (transaction extraction only)
        if (config.stage === 'cc_transactions' || config.stage === 'bank_transactions') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const anyParsed = parsed as any;
          debugLog(config.stage, 'Parsed transaction response keys:', Object.keys(anyParsed));
          if (anyParsed?._debug) {
            debugLog(config.stage, 'Transaction extraction debug:', anyParsed._debug);
            lastDebugInfo = anyParsed._debug;
            // Strip _debug before validation
            delete anyParsed._debug;
          } else {
            debugLog(config.stage, 'No _debug field in response');
            lastDebugInfo = undefined;
          }
        }

        // Log raw summary response for debugging (only on first parse attempt)
        if (config.stage === 'cc_summary' && attempt === 1) {
          debugLog(config.stage, 'Raw LLM response:', rawResponse);
        }
      } catch (parseErr: unknown) {
        errors.length = 0;
        errors.push(`Invalid JSON: ${parseErr instanceof Error ? parseErr.message : 'Unknown error'}`);
        continue;  // Retry with error context
      }

      // Validate
      const validationResult = validateFn(parsed);

      if (validationResult.valid) {
        // Log success with attempt count and extracted data (for debugging)
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

      // Call validation failure callback if provided
      config.onValidationFailure?.(parsed, validationResult.errors);

      // Validation failed — collect errors for retry
      errors.length = 0;
      errors.push(...validationResult.errors);
      lastValidationWarnings = validationResult.warnings;

      // Log retry trigger for debugging prompt effectiveness
      debugLog(`[Retry Engine ${config.stage}] Attempt ${attempt} failed, retrying with failure context...`);
      debugLog(`[Retry Engine ${config.stage}] Errors:`, validationResult.errors);

    } catch (extractErr: unknown) {
      if (config.signal?.aborted) {
        throw extractErr;
      }
      // LLM call failed (network, timeout, etc.)
      errors.length = 0;
      errors.push(`LLM call failed: ${extractErr instanceof Error ? extractErr.message : 'Unknown error'}`);
    }
  }

  // Max retries exhausted — return best-effort output
  return {
    success: false,
    data: lastParsedData,
    errors,
    warnings: lastValidationWarnings,
    attempts: config.maxRetries,
    debugInfo: lastDebugInfo,
  };
}
