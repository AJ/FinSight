import { categorizeTransaction } from "@/lib/categorizer";
import { debugError } from '@/lib/utils/debug';
import { isLLMError } from "@/lib/llm/types";
import { defaultSubtype } from "@/lib/classification/subtypeCategories";
import { TransactionType } from "@/models/TransactionType";
import {
  CategorizationProgress,
  CategorizationResult,
  CategorizationTransactionInput,
} from "./types";
import {
  buildCategorizationPrompt,
  parseCategorizationResponse,
} from "./prompts";

import type { StatementType } from "@/types/creditCard";

export const CATEGORIZATION_BATCH_SIZE = 20;
const NON_CATEGORIZABLE_CATEGORY_IDS = new Set(["transfer", "investment"]);

export function shouldSkipAICategorization(
  transaction: Pick<CategorizationTransactionInput, "categoryId">
): boolean {
  return transaction.categoryId
    ? NON_CATEGORIZABLE_CATEGORY_IDS.has(transaction.categoryId)
    : false;
}

export function categorizeByKeywords(
  transaction: Pick<CategorizationTransactionInput, "description" | "amount" | "type" | "transactionSubType">
): string {
  // Keyword matching is subtype-constrained. Classification is the subtype authority, so a
  // transaction reaching this fallback (the LLM failure path) may carry no subtype — infer
  // one from direction via defaultSubtype, the same pattern the Transaction factories use.
  const subType =
    transaction.transactionSubType
    ?? defaultSubtype(transaction.type === "credit" ? TransactionType.Credit : TransactionType.Debit).transactionSubType;
  return categorizeTransaction(transaction.description, subType);
}

export interface CategorizationCoreOptions {
  generate: (prompt: string) => Promise<string>;
  onProgress?: (progress: CategorizationProgress) => void;
  batchSize?: number;
  statementType?: StatementType;
}

export function batchTransactions<T>(
  transactions: T[],
  batchSize: number = CATEGORIZATION_BATCH_SIZE
): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < transactions.length; i += batchSize) {
    batches.push(transactions.slice(i, i + batchSize));
  }
  return batches;
}

export async function runCategorizationCore(
  transactions: CategorizationTransactionInput[],
  options: CategorizationCoreOptions
): Promise<CategorizationResult[]> {
  if (transactions.length === 0) {
    return [];
  }

  const categorizableTransactions = transactions.filter(
    (transaction) => !shouldSkipAICategorization(transaction)
  );

  if (categorizableTransactions.length === 0) {
    return [];
  }

  const allResults: CategorizationResult[] = [];
  const batches = batchTransactions(
    categorizableTransactions,
    options.batchSize ?? CATEGORIZATION_BATCH_SIZE
  );

  for (let index = 0; index < batches.length; index++) {
    const batch = batches[index];

    options.onProgress?.({
      total: categorizableTransactions.length,
      processed: allResults.length,
      current: batch.length,
    });

    const prompt = buildCategorizationPrompt(batch, options.statementType);

    try {
      const response = await options.generate(prompt);
      const parsedResults = parseCategorizationResponse(response);

      for (const transaction of batch) {
        const result = parsedResults.find((candidate) => candidate.id === transaction.id);
        if (result) {
          allResults.push({
            ...result,
          });
        } else {
          allResults.push({
            id: transaction.id,
            category: categorizeByKeywords(transaction),
            confidence: 0.3,
            source: "keyword",
          });
        }
      }
    } catch (error) {
      // A user cancellation (abort) must propagate so the caller can stop the whole pipeline
      // instead of silently finishing on keyword fallback. Only 'cancelled' rethrows; every
      // other failure degrades to keyword categorization so the user still gets a result.
      if (isLLMError(error) && error.kind === 'cancelled') {
        throw error;
      }
      debugError('Categorizer', `Batch ${index + 1} failed:`, error);
      for (const transaction of batch) {
        allResults.push({
          id: transaction.id,
          category: categorizeByKeywords(transaction),
          confidence: 0.3,
          source: "keyword",
        });
      }
    }
  }

  options.onProgress?.({
    total: categorizableTransactions.length,
    processed: categorizableTransactions.length,
    current: 0,
  });

  return allResults;
}
