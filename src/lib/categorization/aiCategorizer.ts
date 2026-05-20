import { Transaction, CategorizedBy } from "@/types";
import { Category } from "@/models/Category";
import { getClient } from "@/lib/llm/index";
import { LLMProvider } from "@/lib/llm/types";
import { getContextWindowInfo } from "@/lib/llm/contextWindow";
import { findMerchantRuleForTransaction } from "@/lib/services/merchantRuleService";
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

const PROMPT_OVERHEAD_TOKENS = 1500;
const AVG_TOKENS_PER_TRANSACTION = 60;
const MAX_BATCH_SIZE = 50;
const MIN_BATCH_SIZE = 5;

export function deriveBatchSize(contextWindowTokens: number): number {
  const budget = contextWindowTokens - PROMPT_OVERHEAD_TOKENS;
  const raw = Math.floor(budget / AVG_TOKENS_PER_TRANSACTION);
  if (raw <= 0) return 1;
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
      return client.generate(options.baseUrl, options.model!.trim(), prompt, {
        stage: 'categorize',
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
    });
  });
}

export { batchTransactions, categorizeByKeywords };
