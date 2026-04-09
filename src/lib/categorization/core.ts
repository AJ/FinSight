import { categorizeTransaction } from "@/lib/categorizer";
import { DEFAULT_CATEGORIES } from "./categories";
import { debugError } from '@/lib/utils/debug';
import {
  CategorizationProgress,
  CategorizationResult,
  CategorizationTransactionInput,
  toTransactionType,
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
  transaction: Pick<CategorizationTransactionInput, "description" | "amount" | "type">
): string {
  return categorizeTransaction(
    transaction.description,
    transaction.amount,
    DEFAULT_CATEGORIES,
    toTransactionType(transaction.type)
  );
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
