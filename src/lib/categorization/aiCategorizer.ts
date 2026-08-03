import { Transaction, CategorizedBy } from "@/types";
import { Category } from "@/models/Category";
import { getClient } from "@/lib/llm/index";
import { LLMError, LLMProvider } from "@/lib/llm/types";
import {
  getContextWindowInfo,
  calculateMaxOutputTokens,
  calculateMaxItems,
  overflowKind,
} from "@/lib/llm/contextWindow";
import { CATEGORIZATION_SYSTEM_PROMPT, CATEGORIZATION_SCHEMA } from "./prompts";
import { findMerchantRuleForTransaction } from "@/lib/services/merchantRuleService";
import { isValidCombo, defaultSubtype } from "@/lib/classification/subtypeCategories";
import { addReason, type ReviewReason } from "@/lib/review/reviewReasons";
import { debugLog } from "@/lib/utils/debug";
import type { StatementType } from "@/types/creditCard";
import {
  batchTransactions,
  categorizeByKeywords,
  runCategorizationCore,
  shouldSkipAICategorization,
} from "./core";
import {
  CategorizationProgress,
  CategorizationResult,
  CategorizationTransactionInput,
  toCategorizationInput,
} from "./types";

export type { CategorizationProgress, CategorizationResult } from "./types";

// Per-transaction token estimates (linear-coupled regime, spec §6/§13). Starting values —
// calibrate live. INPUT = description + amount + date in the batch prompt; OUTPUT = category
// + confidence.
const INPUT_TOKENS_PER_TRANSACTION = 40;
const OUTPUT_TOKENS_PER_TRANSACTION = 15;
const MAX_BATCH_SIZE = 50;
const MIN_BATCH_SIZE = 5;

/**
 * Max transactions per batch via the linear-coupled solve (spec §6): input + output both
 * scale per transaction. `CATEGORIZATION_SYSTEM_PROMPT` is the fixed overhead (the persona +
 * category taxonomy + rules, delivered as the system message); the [MIN,MAX] clamp absorbs
 * any undercount.
 */
export function deriveBatchSize(contextWindowTokens: number): number {
  const raw = calculateMaxItems(
    contextWindowTokens,
    CATEGORIZATION_SYSTEM_PROMPT,
    INPUT_TOKENS_PER_TRANSACTION,
    OUTPUT_TOKENS_PER_TRANSACTION,
  );
  if (!raw || raw <= 0) return 1;
  return Math.max(MIN_BATCH_SIZE, Math.min(MAX_BATCH_SIZE, raw));
}

/**
 * Options for categorization.
 */
export interface CategorizationOptions {
  provider: LLMProvider;
  baseUrl: string;
  model?: string;
  statementType?: StatementType;
  onProgress?: (progress: CategorizationProgress) => void;
  signal?: AbortSignal;
}

function toPromptInput(transaction: Transaction): CategorizationTransactionInput {
  return toCategorizationInput(transaction);
}

/**
 * Categorize transactions using learned rules first, then the LLM.
 */
export async function categorizeTransactions(
  transactions: Transaction[],
  options: CategorizationOptions
): Promise<CategorizationResult[]> {
  if (transactions.length === 0) {
    return [];
  }

  const inputs = transactions.map(toPromptInput);
  const eligibleInputs = inputs.filter((transaction) => !shouldSkipAICategorization(transaction));

  if (eligibleInputs.length === 0) {
    return [];
  }

  if (!options.model?.trim()) {
    throw new Error('AI categorization requires a model. Configure a model in settings.');
  }

  const client = getClient(options.provider);
  const contextInfo = await getContextWindowInfo({
    provider: options.provider,
    baseUrl: options.baseUrl,
    model: options.model!.trim(),
  });

  const aiResults = await runCategorizationCore(eligibleInputs, {
    generate: async (prompt) => {
      // Context-aware output budget on the full input actually sent (system prompt + batch
      // prompt). On overflow (calculateMaxOutputTokens returns 0), throw an LLMError with a
      // classified kind — runCategorizationCore catches this per-batch (core.ts) and falls
      // through to keyword categorization for that batch.
      const maxOutputTokens = calculateMaxOutputTokens(
        contextInfo.contextLength,
        `${CATEGORIZATION_SYSTEM_PROMPT}\n\n${prompt}`,
      );
      if (maxOutputTokens === 0) {
        throw new LLMError(
          `Categorization prompt exceeds the model's context window (${contextInfo.contextLength} tokens).`,
          overflowKind(contextInfo.contextLength),
        );
      }
      return client.generate(options.baseUrl, options.model!.trim(), prompt, {
        stage: 'categorize',
        maxOutputTokens,
        contextWindow: contextInfo.contextLength,
        responseFormat: 'json',
        responseSchema: CATEGORIZATION_SCHEMA,
        schemaName: 'categorization',
        systemPrompt: CATEGORIZATION_SYSTEM_PROMPT,
        signal: options.signal,
      });
    },
    onProgress: options.onProgress
      ? (progress) =>
          options.onProgress?.({
            total: eligibleInputs.length,
            processed: progress.processed,
            current: progress.current,
          })
      : undefined,
    statementType: options.statementType,
    batchSize: contextInfo.contextLength
      ? deriveBatchSize(contextInfo.contextLength)
      : undefined,
  });

  // Merchant rules apply AFTER classification as an override (user intent wins). The LLM has
  // already decided subtype+category for every transaction; a matching rule overrides the CATEGORY
  // only, keeping the LLM subtype. Combo validity is checked once in applyCategorizationResults.
  const txnsById = new Map(transactions.map((t) => [t.id, t]));
  return aiResults.map((result) => {
    const txn = txnsById.get(result.id);
    if (!txn) return result;
    const matchedRule = findMerchantRuleForTransaction(txn);
    if (!matchedRule?.activeCategoryId) return result;
    debugLog('MerchantRules', '[APPLIED override]', {
      merchantKey: matchedRule.merchantKey,
      categoryId: matchedRule.activeCategoryId,
      overLLM: result.category,
    });
    return {
      ...result,
      category: matchedRule.activeCategoryId,
      confidence: 0.98,
      source: "rule" as const,
    };
  });
}

/**
 * Apply categorization results to transactions.
 * Sets confidence-based flags and preserves all existing metadata.
 */
export function applyCategorizationResults(
  transactions: Transaction[],
  results: CategorizationResult[]
): Transaction[] {
  const resultsMap = new Map(results.map((result) => [result.id, result]));

  return transactions.map((transaction) => {
    const result = resultsMap.get(transaction.id);
    if (!result) {
      return transaction;
    }

    const resolvedCategory = Category.fromId(result.category) ?? transaction.category;
    const categorizedBy =
      result.source === "rule"
        ? CategorizedBy.Rule
        : result.source === "ai"
          ? CategorizedBy.AI
          : CategorizedBy.Keyword;

    // Classification is the subtype authority. A subtype is "inferred" when CLASSIFICATION did
    // not supply one (result.transactionSubType) — not when the transaction happened to carry
    // one. Pre-classification rows may carry a load-guaranteed default subtype (from fromJSON),
    // and that must NOT mask the fact that classification actually returned nothing. The
    // LLM-failure / keyword-fallback rows therefore read wasInferred and get llmConfidence 0 so
    // the subtype_inferred review reason fires (the durable inferred signal).
    const wasInferred = !result.transactionSubType;
    const resolvedSubType =
      result.transactionSubType ?? transaction.transactionSubType ?? defaultSubtype(transaction.type).transactionSubType;

    // Categorization-side review reasons (spec §6.3). Collect-all: a row can carry both
    // at once. low_confidence is NOT stamped here — it is owned by the verification stamper.
    let reasons: ReviewReason[] = [...transaction.reviewReasons];
    // self_transfer_unresolved is DETERMINISTIC: every self_transfer is ownership-unresolved
    // by definition (the narration alone cannot confirm own-account movement).
    if (resolvedSubType === "self_transfer") {
      reasons = addReason(reasons, "self_transfer_unresolved");
    }
    // Single combo-validity check over the final (possibly overridden) category. Skipped when
    // the subtype is a guess: wasInferred (classification defaulted it) OR the legacy
    // llmConfidence===0 signal (CSV/XLS rows whose subtype is a direction default). A dummy
    // subtype vs a real category is the dummy's fault, not a data error.
    const subtypeIsGuess = wasInferred || transaction.llmConfidence === 0;
    if (!subtypeIsGuess && !isValidCombo(resolvedSubType, resolvedCategory.id)) {
      reasons = addReason(reasons, "invalid_subtype_category");
    }

    return Transaction.fromJSON({
      ...transaction.toJSON(),
      category: resolvedCategory.id,
      categoryConfidence: result.confidence,
      reviewReasons: reasons,
      categorizedBy,
      transactionSubType: resolvedSubType,
      llmConfidence: wasInferred ? 0 : transaction.llmConfidence,
    });
  });
}

export { batchTransactions, categorizeByKeywords };
