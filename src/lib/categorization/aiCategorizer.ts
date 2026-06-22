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

  const ruleResults: CategorizationResult[] = [];
  const remainingInputs: CategorizationTransactionInput[] = [];

  for (const transaction of transactions) {
    const input = toPromptInput(transaction);
    if (shouldSkipAICategorization(input)) {
      continue;
    }

    const matchedRule = findMerchantRuleForTransaction(transaction);
    if (matchedRule) {
      debugLog('MerchantRules', '[APPLIED]', {
        merchantKey: matchedRule.merchantKey,
        categoryId: matchedRule.activeCategoryId,
      });
      ruleResults.push({
        id: transaction.id,
        category: matchedRule.activeCategoryId!,
        confidence: 0.98,
        source: "rule",
      });
      continue;
    }

    remainingInputs.push(input);
  }

  if (remainingInputs.length === 0) {
    options.onProgress?.({
      total: eligibleInputs.length,
      processed: eligibleInputs.length,
      current: 0,
    });
    return ruleResults;
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

  const aiResults = await runCategorizationCore(remainingInputs, {
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
      });
    },
    onProgress: options.onProgress
      ? (progress) =>
          options.onProgress?.({
            total: eligibleInputs.length,
            processed: ruleResults.length + progress.processed,
            current: progress.current,
          })
      : undefined,
    statementType: options.statementType,
    batchSize: contextInfo.contextLength
      ? deriveBatchSize(contextInfo.contextLength)
      : undefined,
  });

  return [...ruleResults, ...aiResults];
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

    const needsReview = result.confidence < 0.85;
    const categorizedBy =
      result.source === "rule"
        ? CategorizedBy.Rule
        : result.source === "ai"
          ? CategorizedBy.AI
          : CategorizedBy.Keyword;

    return Transaction.fromJSON({
      ...transaction.toJSON(),
      category: (Category.fromId(result.category) ?? transaction.category).id,
      categoryConfidence: result.confidence,
      needsReview,
      categorizedBy,
      isSuspense: result.isSuspense ?? false,
    });
  });
}

export { batchTransactions, categorizeByKeywords };
