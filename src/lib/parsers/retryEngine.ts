/**
 * Retry engine with failure context.
 *
 * Retries LLM calls with validation feedback injected into the prompt.
 * Each retry tells the LLM exactly what was wrong with its previous output.
 */

import { parseLLMJsonResponse } from '@/lib/utils/llm-response-parser';
import { getClient } from '@/lib/llm/index';
import { LLMError } from '@/lib/llm/types';
import type { LLMRuntimeConfig, JSONSchema } from '@/lib/llm/types';
import { calculateMaxOutputTokens, overflowKind, getInputCharsPerToken } from '@/lib/llm/contextWindow';
import { EXTRACTION_SYSTEM_PROMPT } from '@/lib/llm/prompts';
import { debugLog } from '@/lib/utils/debug';

export interface RetryConfig {
  maxRetries: number;
  stage: string;
  contextWindowTokens?: number;
  // Required: retryEngine always runs in json mode, and json mode requires a schema (the
  // adapter guard enforces the pairing). Each stage supplies its own shape.
  responseSchema: JSONSchema;
  schemaName: string;
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
  /**
   * True when the pre-flight guard detected that the prompt (system + stage + input
   * buffer) already meets/exceeds the model's context window. Callers use this to
   * distinguish overflow (doomed call, no point retrying) from validation failures.
   * Set by the retry loop when calculateMaxOutputTokens returns 0 before a call is attempted.
   */
  contextOverflow?: boolean;
}

export interface ValidationResult<T> {
  valid: boolean;
  errors: string[];
  warnings: string[];
  data: T | null;
}

// Reserve this fraction of the context window for output when sizing the retry prompt. The
// retry must PASS the pre-flight guard (which needs output room), so the prompt is capped to
// leave (1 - PROMPT_WINDOW_FRACTION) of the window free for generation.
const PROMPT_WINDOW_FRACTION = 0.75;

export function buildRetryPrompt(
  basePrompt: string,
  previousOutput: string,
  errors: string[],
  attempt: number,
  opts: { contextWindowTokens?: number; systemPrompt: string },
): string {
  let strictnessInstruction = '';
  if (attempt === 2) {
    strictnessInstruction = 'Fix ALL errors listed above. Return ONLY valid JSON.';
  } else if (attempt >= 3) {
    strictnessInstruction = 'Return ONLY the minimal valid JSON structure. No extra fields. No text outside JSON.';
  } else {
    strictnessInstruction = 'Fix all errors and return valid JSON.';
  }

  const errorsBlock = errors.map(e => `- ${e}`).join('\n');
  // Split the framing into the part before the previousOutput slice and the part after, so the
  // slice budget can account for the REAL after-part length (errorsBlock + strictnessInstruction
  // + tail). The concatenated string is identical to the old single-template version.
  const tail = '\nDo not include explanations or markdown fences.';
  const beforePrev = '\n\n---\nPREVIOUS OUTPUT (INVALID):\n';
  const afterPrev = `\n\n---\nVALIDATION ERRORS TO FIX:\n${errorsBlock}\n\n---\nINSTRUCTIONS:\n${strictnessInstruction}${tail}`;
  const framing = (prevSlice: string) => `${beforePrev}${prevSlice}${afterPrev}`;

  // Decide how much of previousOutput can be included without blowing the prompt budget. The
  // framing length (before + after) is passed in so the budget accounts for the real errorsBlock
  // and strictness text — not a fixed placeholder that silently under-counts them.
  const prevSlice = allowedPreviousSlice(basePrompt, previousOutput, opts, beforePrev.length + afterPrev.length);

  return `${basePrompt}${framing(prevSlice)}`;
}

/**
 * Return the slice of previousOutput that fits the prompt budget, or '' if even a minimal
 * inclusion leaves too little output room. When contextWindow is unknown (guard skipped),
 * include the whole thing (the guard cannot trip). Tail-truncate because JSON errors cluster
 * at the end (trailing fields, fence artifacts).
 */
function allowedPreviousSlice(
  basePrompt: string,
  previousOutput: string,
  opts: { contextWindowTokens?: number; systemPrompt: string },
  framingChars: number,
): string {
  const { contextWindowTokens, systemPrompt } = opts;
  const inputRatio = getInputCharsPerToken();
  // Budget in prompt chars: leave (1 - PROMPT_WINDOW_FRACTION) of the window for output.
  const maxPromptChars = contextWindowTokens
    ? contextWindowTokens * PROMPT_WINDOW_FRACTION * inputRatio
    : Infinity;

  // Length of everything in the prompt EXCEPT the previousOutput slice: system + base, the
  // real framing (errorsBlock + strictnessInstruction + tail, passed in via framingChars), and a
  // truncation marker allowance. This is a faithful lower bound — every component is measured,
  // none are a fixed placeholder.
  const marker = '\n[…truncated…]';
  const overhead = `${systemPrompt}\n\n${basePrompt}`.length + framingChars + marker.length;

  if (overhead >= maxPromptChars) {
    // No room for any previousOutput — retry on the error list alone. The base prompt alone
    // fit on attempt 1, so this is always recoverable.
    return '';
  }

  const budget = maxPromptChars - overhead;
  // If the usable slice is shorter than the truncation marker itself, keeping it would add the
  // marker plus a few stray chars of noise — pointless. Retry on the error list alone instead.
  if (budget < marker.length) {
    return '';
  }
  if (previousOutput.length <= budget) {
    return previousOutput;
  }
  // Tail-truncate: keep the final `budget` chars (where JSON breakage usually is).
  return `${marker}\n` + previousOutput.slice(-Math.floor(budget));
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
  let contextOverflow = false;
  let attemptsMade = 0;

  const client = getClient(config.llmConfig.provider);

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    attemptsMade = attempt;
    try {
      const prompt = attempt === 1
        ? basePrompt.replace('{RAW_TEXT}', normalizedText)
        : buildRetryPrompt(basePrompt, lastRawOutput!, errors, attempt, {
            contextWindowTokens: config.contextWindowTokens,
            systemPrompt: EXTRACTION_SYSTEM_PROMPT,
          });

      if (attempt === 1 && (config.stage === 'cc_transactions' || config.stage === 'bank_transactions')) {
        debugLog(config.stage, 'Normalized text sent to LLM for transaction extraction:');
        debugLog(config.stage, normalizedText);
        debugLog(config.stage, '--- END NORMALIZED TEXT ---');
      }

      // Context-aware output budget on the FULL input actually sent (system prompt +
      // stage prompt). Recomputed per attempt — retry prompts are larger (previous output
      // + validation errors appended), so the budget shrinks.
      //   undefined → context unknown, skip guard, omit maxOutputTokens
      //   0         → full input already ≥ context window → OVERFLOW, bail
      //   > 0       → output budget to pass as maxOutputTokens
      const maxOutputTokens = calculateMaxOutputTokens(
        config.contextWindowTokens,
        `${EXTRACTION_SYSTEM_PROMPT}\n\n${prompt}`,
      );
      if (maxOutputTokens === 0) {
        // Pre-flight overflow: the prompt does not fit the context window. Retrying
        // with an even larger prompt cannot help — record a classified LLMError and bail.
        contextOverflow = true;
        const overflow = new LLMError(
          `Input text exceeds the model's context window (${config.contextWindowTokens} tokens).`,
          overflowKind(config.contextWindowTokens),
        );
        errors.length = 0;
        errors.push(overflow.message);
        debugLog(`[Retry Engine ${config.stage}] Pre-flight overflow guard triggered on attempt ${attempt}`);
        break;
      }

      const rawResponse = await client.generate(
        config.llmConfig.baseUrl,
        config.llmConfig.model,
        prompt,
        { stage: config.stage, maxOutputTokens, contextWindow: config.contextWindowTokens, responseFormat: 'json', responseSchema: config.responseSchema, schemaName: config.schemaName, systemPrompt: EXTRACTION_SYSTEM_PROMPT, signal: config.signal },
      );
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

        if (config.stage === 'cc_summary' || config.stage === 'bank_summary') {
          debugLog(config.stage, 'Raw LLM response:', rawResponse);
        }
      } catch (parseErr: unknown) {
        // TODO(detect-and-shrink): a common cause of "Invalid JSON" here is output truncation —
        // the model hit its maxOutputTokens cap mid-JSON. Calibration (per-model output ratio)
        // prevents this in the common case, but a pathological statement can still overrun its
        // chunk. The safety net: surface finish_reason from the adapter (currently debug-logged
        // only, not returned in GenerateResult), and on "length" re-split the offending chunk
        // smaller and re-extract. See docs/superpowers/specs/2026-08-12-token-ratio-calibration-design.md
        // ("Out of scope — tracked as code TODOs").
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
      // An LLMError already carries a classified kind (assigned by the adapter/surface);
      // overflow is handled by the pre-flight guard above, not by string-matching the
      // message (spec §7). Record the message and let the retry policy decide.
      errors.length = 0;
      const msg = extractErr instanceof Error ? extractErr.message : 'Unknown error';
      errors.push(`LLM call failed: ${msg}`);
    }
  }

  return {
    success: false,
    data: lastParsedData,
    errors,
    warnings: lastValidationWarnings,
    attempts: attemptsMade,
    debugInfo: lastDebugInfo,
    contextOverflow,
  };
}
