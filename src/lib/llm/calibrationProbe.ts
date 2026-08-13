/**
 * Per-model token-ratio calibration.
 *
 * The whole token-budget system rests on chars/token ratios. A single universal 2.3
 * (calibrated on qwen3-4b) is wrong for every other model, and OUTPUT_TOKENS_PER_LINE = 5 was
 * a ~20x underestimate that truncated transaction output. Instead, measure the real model.
 *
 * The probe sends a fixed sample, asks the model to extract it as transaction JSON, and reads
 * the server-reported prompt/completion token counts (both adapters already capture these).
 *   inputCharsPerToken       = fullPrompt.length / promptTokens
 *   outputTokensPerInputLine = completionTokens / sampleLineCount
 * The output figure folds in both the tokenizer rate and the model's JSON verbosity.
 *
 * Why the two ratios use different units — each is in the unit forced by what's known on
 * that side. Input is raw text already in hand, so input tokens = chars ÷ (chars/token).
 * Output doesn't exist yet; the only available predictor of its size is how many
 * transactions the model will emit, which tracks the input line count, so output tokens =
 * lines × (tokens/line). Both ratios are model-intrinsic (tokenizer rate; JSON verbosity)
 * and transfer across statements; the statement-specific part (chars per line) is measured
 * live at chunk time, not baked into either ratio. At the chunker the two become
 * commensurable — tokens-per-line on both sides — and are summed in calculateMaxItems.
 * Storing the output side as chars/token instead would be mathematically equivalent but
 * would need a second stored number (output chars per line) to be usable, and would
 * recombine to this same value.
 *
 * See docs/superpowers/specs/2026-08-12-token-ratio-calibration-design.md.
 */
import { getClient } from './index';
import type { LLMRuntimeConfig, TokenUsage } from './types';
import { useSettingsStore, calibrationKey, type CalibrationRatios } from '@/lib/store/settingsStore';
import { debugLog, debugWarn } from '@/lib/utils/debug';

// A large, realistic block of statement lines (date, merchant + city, amount, DR/CR). Currency is
// omitted: per-line currency codes aren't reliably present in real statements (this app's INR
// statements carry currency at statement level), and the measurement is insensitive to it anyway
// (3-letter ASCII codes tokenize like the merchant words already present, and output cost is set
// by the instruction's field set, not the input content).
// Large relative to the one-line instruction so promptTokens is dominated by the sample, making
// the measured ratio representative of statement text rather than instruction prose.
export const CALIBRATION_SAMPLE = [
  '04 MAR STARBUCKS MUMBAI 450.00 DR',
  '05 MAR AMAZON RETAIL BENGALURU 2,399.00 DR',
  '06 MAR BIG BASKET GROCERY 1,850.50 DR',
  '07 MAR SALARY CREDIT HYDERABAD 95,000.00 CR',
  '08 MAR NETFLIX SUBSCRIPTION 649.00 DR',
  '09 MAR UBER RIDES BENGALURU 320.00 DR',
  '10 MAR SWIGGY FOOD ORDER 540.00 DR',
  '11 MAR ELECTRICITY BILL MUMBAI 2,100.00 DR',
  '12 MAR PHONEPE TRANSFER FRIEND 1,000.00 DR',
  '13 MAR BOOKMYSHOW TICKETS 720.00 DR',
  '14 MAR FUEL BP PETROL PUMP 3,500.00 DR',
  '15 MAR INTEREST CREDIT SAVINGS 12.40 CR',
  '16 MAR ZOMATO FOOD DELIVERY 610.00 DR',
  '17 MAR FLIPKART ELECTRONICS 4,999.00 DR',
  '18 MAR GYM MEMBERSHIP ANNUAL 8,000.00 DR',
  '19 MAR ATM CASH WITHDRAWAL 2,000.00 DR',
  '20 MAR GOOGLE CLOUD SERVICES 1,200.00 DR',
  '21 MAR INSURANCE PREMIUM 5,600.00 DR',
  '22 MAR BROADBILL FIBER NET 999.00 DR',
  '23 MAR MEDPLUS PHARMACY 245.00 DR',
  '24 MAR RELIANCE FRESH GROCERY 1,332.00 DR',
  '25 MAR IRCTC TRAIN TICKET 880.00 DR',
  '26 MAR SPOTIFY PREMIUM 119.00 DR',
  '27 MAR CARAFE COFFEE ROASTERS 340.00 DR',
  '28 MAR HOTEL STAY GOA 7,500.00 DR',
  '29 MAR REFUND PROCESSED RETAILER 1,499.00 CR',
  '30 MAR DENTAL CLINIC VISIT 1,800.00 DR',
  '31 MAR RENT TRANSFER LANDLORD 22,000.00 DR',
  '01 APR CRED BILL PAY 4,500.00 DR',
  '02 APR AMAZON PRIME RENEWAL 149.00 DR',
  '03 APR LOCAL KIRANA STORE 220.00 DR',
  '04 APR PETROL INDMAX FUEL 2,750.00 DR',
  '05 APR COURSERA LEARNING 899.00 DR',
  '06 APR H&M APPAREL STORE 1,299.00 DR',
  '07 APR GROCERY OUTLET DELHI 980.00 DR',
  '08 APR FASTAG RECHARGE 200.00 DR',
  '09 APR DOMINOS PIZZA ORDER 599.00 DR',
  '10 APR SALARY CREDIT HYDERABAD 95,000.00 CR',
  '11 APR MEDLIFE PHARMACY 410.00 DR',
  '12 APR MAKEMYTRIP FLIGHT BOOKING 6,200.00 DR',
].join('\n');

// Mirror the real transaction-extraction field set so the measured outputTokensPerInputLine is
// representative of actual extraction. Uses the credit-card shape (the heaviest real case: the
// transactionBase keys date, description, amount, type, reasoning, confidence, plus the four
// CC currency/international fields), wrapped in the {transactions:[...]} envelope the real
// extractor emits. CC is heavier than bank (bank adds only `balance`), and the chunker is shared
// across both statement types, so calibrating to the heavier shape correctly sizes CC chunks and
// slightly over-reserves for bank — and under-reserving is the bug. `reasoning` is the dominant
// cost driver; it was missing from the earlier thin probe, which under-measured and reproduced
// the truncation bug.
const CALIBRATION_INSTRUCTION =
  'Extract each transaction line below as a JSON object {"transactions":[...]} where each array ' +
  'element has keys: date, description, amount, type ("debit" or "credit"), reasoning, confidence, ' +
  'localCurrency, isInternationalTransaction, originalCurrency, originalAmount. ' +
  'Return ONLY the JSON object, no explanation.';

function buildProbePrompt(): string {
  return `${CALIBRATION_INSTRUCTION}\n\n${CALIBRATION_SAMPLE}`;
}

/**
 * Pure derivation. Returns null when the reported counts are unusable (missing or zero —
 * Ollama reports prompt_eval_count = 0 when the prompt is cached; some LM Studio builds return
 * null usage). Never throws on bad input.
 */
export function deriveRatios(
  prompt: string,
  usage: TokenUsage | undefined,
  sampleLineCount: number,
): CalibrationRatios | null {
  if (!usage) return null;
  // Strictly-positive (not just falsy): a buggy server reporting 0, negative, or NaN counts must
  // fall back to defaults rather than produce a negative/Infinity ratio that poisons chunk budgets.
  if (!(usage.promptTokens > 0) || !(usage.completionTokens > 0)) return null;
  if (sampleLineCount <= 0) return null;
  return {
    inputCharsPerToken: prompt.length / usage.promptTokens,
    outputTokensPerInputLine: usage.completionTokens / sampleLineCount,
  };
}

/**
 * Run the probe against the model and return the measured ratios, or null on any failure
 * (network, timeout, unusable usage). Calibration is an optimization, never a gate — callers
 * fall back to the defaults on null.
 */
export async function runCalibrationProbe(
  llmConfig: LLMRuntimeConfig,
  signal?: AbortSignal,
): Promise<CalibrationRatios | null> {
  const prompt = buildProbePrompt();
  const sampleLineCount = CALIBRATION_SAMPLE.split('\n').length;
  try {
    const client = getClient(llmConfig.provider);
    // No maxOutputTokens cap — a cap would truncate the output and corrupt the measurement.
    // No systemPrompt — so promptTokens reflects only the probe string.
    // Text mode (NOT json): both adapters' assertStructuredOptions guard requires a paired
    // schema + schemaName for json mode and throws otherwise. The probe has no schema — it only
    // reads usage.completionTokens, and the response content is irrelevant — so text mode is the
    // honest choice (and with ENFORCE_JSON_SCHEMA_ON_WIRE=false the two are wire-identical anyway).
    const result = await client.generateWithUsage(
      llmConfig.baseUrl,
      llmConfig.model,
      prompt,
      {
        temperature: 0,
        responseFormat: 'text',
        stage: 'calibration',
        signal,
        // 180s covers warm + mildly-cold 1-4B models (the parsing default per CLAUDE.md). A
        // correct probe emits ~3,900 tokens (40 lines × ~98 tokens/line of real extraction
        // verbosity), which is ~65-195s on local 1-4B hardware — NOT the 5-10s a thin probe
        // would take. Slower/cold 7-8B models may time out and fall back to the safe
        // DEFAULT_OUTPUT_TOKENS_PER_LINE; calibration is an optimization, never a gate. The
        // cost is one-time per model (cached in settingsStore).
        timeout: 180_000,
      },
    );
    const ratios = deriveRatios(prompt, result.usage, sampleLineCount);
    if (!ratios) {
      debugWarn('Calibration', 'Probe returned unusable usage; falling back to defaults', result.usage);
    } else {
      debugLog('Calibration', `Measured inputCharsPerToken=${ratios.inputCharsPerToken.toFixed(2)} outputTokensPerInputLine=${ratios.outputTokensPerInputLine.toFixed(1)}`);
    }
    return ratios;
  } catch (e) {
    debugWarn('Calibration', `Probe failed; falling back to defaults: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/**
 * Ensure the current (provider, model) is calibrated. Cache hit → no-op. Cache miss → probe
 * and store. On probe failure, leaves the cache empty so consumers fall back to the defaults.
 */
export async function ensureModelCalibrated(
  llmConfig: LLMRuntimeConfig,
  signal?: AbortSignal,
): Promise<void> {
  const s = useSettingsStore.getState();
  const key = calibrationKey(s.llmProvider, s.llmModel);
  if (key && s.calibrationByModel[key]) {
    return; // cache hit — this (provider, model) was probed before
  }
  const ratios = await runCalibrationProbe(llmConfig, signal);
  if (ratios) {
    useSettingsStore.getState().setModelCalibration(ratios);
  }
}
