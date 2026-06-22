import type { LLMProvider, FailureKind } from './types';
import { getClient } from './index';
import { useSettingsStore } from '@/lib/store/settingsStore';

export interface ContextWindowInfo {
  /**
   * The model's context window in tokens, or `undefined` when it could not be resolved.
   *
   * `undefined` deliberately covers two distinct cases that this resolver does NOT
   * distinguish (kept simple — for a local LLM the difference rarely matters):
   *  - the server/model list could not be reached (unavailable), or
   *  - the server was reached but the model has no exposed context length (undeterminable).
   *
   * Callers treat `undefined` as "skip the pre-flight overflow guard" — the call proceeds
   * without a budget. An unreachable server surfaces anyway as a failure at the generate
   * call itself; an undeterminable window means we proceed unguarded, which is the safe
   * default (no fabricated number).
   */
  contextLength: number | undefined;
  source: 'settings_cache' | 'listModels_fallback';
  provider: LLMProvider;
  modelId: string | null;
}

export interface ContextWindowOverrides {
  provider: LLMProvider;
  baseUrl: string;
  model: string;
}

// Estimation-error pads (spec §6; tuning values, see spec §13). estimateTokens divides
// chars by a fixed ratio, so its absolute error grows with text size — a flat token count
// is a huge pad on a small prompt and a tiny one on a large one. Each buffer is therefore
// a fraction of what it guards, not a fixed number.
// Input buffer: a fraction of the input estimate itself.
const INPUT_BUFFER_RATIO = 0.10;
// Output buffer: a fraction of the output room left after input. Being a fraction of the
// room, it can never exceed it — so the returned budget is structurally non-negative.
const OUTPUT_BUFFER_RATIO = 0.10;

/**
 * Chars-per-token ratio. Measured ~2.36 for bank-statement text against the
 * qwen3-4b tokenizer (calibrated in tests/live/tokenBudget.spec.ts:494-535).
 * 2.3 is slightly conservative (estimates a few more tokens than actual), which
 * is the safe direction — better to underestimate available budget than overestimate.
 * Single source of truth: imported by transactionChunking.ts and browserGenerator.ts.
 * Do not re-implement /4 elsewhere.
 */
export const CHARS_PER_TOKEN = 2.3;

/**
 * Estimate token count from character count using the measured CHARS_PER_TOKEN ratio.
 * Heuristic — not a real tokenizer. Shared across all token-budget code so the ratio
 * lives in one place.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

// Fundamental rule (spec §6): i + o ≤ C. The three functions below are the closed-form
// computations of that rule for the overflow guard (Q1), the non-linear/cap-output regime
// (Q2), and the linear-coupled/per-item regime (Q3). All return `undefined` when the window
// is unknown (caller skips the guard) and `0` when nothing fits (overflow — caller must not
// call). Buffers fold in as ×(1+ratio) terms.

/**
 * Q1 — overflow guard. Given the FULL input text (system prompt + user prompt), returns the
 * output room `C − i − buffers`. Generalized: no hardcoded system-prompt add — the caller
 * passes the real full input (system prompt is caller-supplied, spec §10). Never negative
 * (output buffer is a fraction of the room — bug 6 fixed structurally).
 */
export function calculateMaxOutputTokens(
  contextWindow: number | undefined,
  inputText: string,
): number | undefined {
  if (!contextWindow) return undefined;

  const totalInput = Math.round(estimateTokens(inputText) * (1 + INPUT_BUFFER_RATIO));
  if (totalInput >= contextWindow) return 0; // overflow — caller must not call

  return Math.max(0, Math.floor((contextWindow - totalInput) / (1 + OUTPUT_BUFFER_RATIO)));
}

/**
 * Q2 — non-linear regime. Given the fixed (non-variable) input text and an output cap `O`
 * the caller chooses, returns token room for VARIABLE input data: `C − F − O − buffers`.
 * Used when output does not scale predictably with input (chat retrieved context).
 */
export function calculateMaxInputTokens(
  contextWindow: number | undefined,
  fixedInput: string | number,
  outputCapTokens: number,
): number | undefined {
  if (!contextWindow) return undefined;

  const totalFixed = Math.round(fixedInputTokens(fixedInput) * (1 + INPUT_BUFFER_RATIO));
  const totalOutput = Math.round(outputCapTokens * (1 + OUTPUT_BUFFER_RATIO));
  if (totalFixed + totalOutput >= contextWindow) return 0;

  return Math.max(0, Math.floor((contextWindow - totalFixed - totalOutput) / (1 + INPUT_BUFFER_RATIO)));
}

/**
 * Resolve a caller's "fixed input" to a token count. Most callers pass the literal text
 * (estimated here); callers with a pre-measured overhead (e.g. chunking's transactions-prompt
 * overhead) pass a token count directly, avoiding re-estimation of a known value.
 */
function fixedInputTokens(fixedInput: string | number): number {
  return typeof fixedInput === 'number' ? fixedInput : estimateTokens(fixedInput);
}

/**
 * Q3 — linear-coupled regime. Given per-item input `a` and output `b` tokens (both scale with
 * the item count), returns the max item count that fits: `(C − F − buffers) / (a + b)`.
 * Used when output grows with input (transaction extraction, chunking, categorization).
 * `fixedInput` is the non-variable input — a string (estimated) or a pre-measured token count.
 */
export function calculateMaxItems(
  contextWindow: number | undefined,
  fixedInput: string | number,
  inputTokensPerItem: number,
  outputTokensPerItem: number,
): number | undefined {
  if (!contextWindow) return undefined;

  const totalFixed = Math.round(fixedInputTokens(fixedInput) * (1 + INPUT_BUFFER_RATIO));
  const perItem =
    inputTokensPerItem * (1 + INPUT_BUFFER_RATIO) + outputTokensPerItem * (1 + OUTPUT_BUFFER_RATIO);
  if (perItem <= 0) return 0;

  return Math.max(0, Math.floor((contextWindow - totalFixed) / perItem));
}

// Below this floor, preflight overflow is classified `model-too-small` (the model is
// fundamentally too small for the feature); otherwise `input-too-large` (the request as
// built is too big). Starting value — spec §13 (calibrate live).
export const MIN_VIABLE_CONTEXT_TOKENS = 2048;

/**
 * Classify a preflight overflow (when calculateMaxOutputTokens returned 0) into the kind the
 * caller throws as an LLMError (spec §7). Never dispatched to the provider.
 */
export function overflowKind(contextWindow: number | undefined): FailureKind {
  return contextWindow !== undefined && contextWindow < MIN_VIABLE_CONTEXT_TOKENS
    ? 'model-too-small'
    : 'input-too-large';
}

export async function getContextWindowInfo(
  overrides?: ContextWindowOverrides,
): Promise<ContextWindowInfo> {
  const settings = useSettingsStore.getState();
  const provider = overrides?.provider ?? settings.llmProvider;
  const baseUrl = overrides?.baseUrl ?? settings.llmServerUrl;
  const modelId = overrides?.model ?? settings.llmModel;
  const cached = settings.llmModelContextLength;

  if (cached !== null && cached > 0) {
    return {
      contextLength: cached,
      source: 'settings_cache',
      provider,
      modelId,
    };
  }

  try {
    const client = getClient(provider);
    const models = await client.listModels(baseUrl, modelId ?? undefined);
    const match = modelId
      ? models.find((m) => m.id === modelId)
      : models[0];

    const contextLength = match?.contextLength;
    // Read-only: do not write the settings store. The cache is owned by model
    // selection (onboarding/settings UI), not by this lookup.

    return {
      contextLength,
      source: 'listModels_fallback',
      provider,
      modelId,
    };
  } catch {
    return {
      contextLength: undefined,
      source: 'listModels_fallback',
      provider,
      modelId,
    };
  }
}
