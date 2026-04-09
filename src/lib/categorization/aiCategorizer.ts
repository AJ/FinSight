import { Transaction, Category, CategorizedBy } from "@/types";
import { getBrowserClient } from "@/lib/llm/index";
import { LLMProvider } from "@/lib/llm/types";
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
 * @deprecated Falls back to server-side categorization via /api/categorize.
 * This API route is deprecated. Remove this function when deleting the API route.
 */
async function categorizeTransactionsViaApi(
  transactions: CategorizationTransactionInput[],
  options: CategorizationOptions
): Promise<CategorizationResult[]> {
  if (transactions.length === 0) {
    return [];
  }

  const response = await fetch("/api/categorize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      transactions,
      provider: options.provider,
      baseUrl: options.baseUrl,
      model: options.model,
      statementType: options.statementType,
    }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Categorization failed");
  }

  const data = await response.json();
  return Array.isArray(data.results) ? data.results : [];
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

  const aiResults = options.model?.trim()
    ? await runCategorizationCore(remainingInputs, {
        generate: async (prompt) => {
          const client = getBrowserClient(options.provider);
          return client.generate(options.baseUrl, options.model!.trim(), prompt);
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
      })
    : await categorizeTransactionsViaApi(remainingInputs, options);

  if (!options.model?.trim()) {
    options.onProgress?.({
      total: eligibleInputs.length,
      processed: eligibleInputs.length,
      current: 0,
    });
  }

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
