import { Transaction } from "@/types";
import { getBrowserClient } from "@/lib/llm/index";
import { LLMProvider } from "@/lib/llm/types";
import {
  buildCategorizationPrompt,
  parseCategorizationResponse,
} from "./prompts";
import { DEFAULT_CATEGORIES, getCategoryById } from "./categories";

const BATCH_SIZE = 20;

export interface CategorizationResult {
  id: string;
  category: string;
  confidence: number;
}

export interface CategorizationProgress {
  total: number;
  processed: number;
  current: number;
}

/**
 * Options for categorization.
 */
export interface CategorizationOptions {
  provider: LLMProvider;
  baseUrl: string;
  model: string;
  onProgress?: (progress: CategorizationProgress) => void;
}

/**
 * Split transactions into batches for LLM processing.
 */
export function batchTransactions(
  transactions: Transaction[],
  batchSize: number = BATCH_SIZE
): Transaction[][] {
  const batches: Transaction[][] = [];
  for (let i = 0; i < transactions.length; i += batchSize) {
    batches.push(transactions.slice(i, i + batchSize));
  }
  return batches;
}

/**
 * Categorize transactions using the LLM.
 * Returns results with confidence scores.
 * Note: Transfers are not categorized (they don't have income/expense semantics).
 */
export async function categorizeTransactions(
  transactions: Transaction[],
  options: CategorizationOptions
): Promise<CategorizationResult[]> {
  if (transactions.length === 0) {
    return [];
  }

  // Filter out transfers - they don't need categorization
  const categorizableTransactions = transactions.filter(t => t.type !== 'transfer');

  if (categorizableTransactions.length === 0) {
    return [];
  }

  const client = getBrowserClient(options.provider);
  const batches = batchTransactions(categorizableTransactions);
  const allResults: CategorizationResult[] = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];

    // Report progress
    options.onProgress?.({
      total: categorizableTransactions.length,
      processed: allResults.length,
      current: batch.length,
    });

    // Build prompt for this batch
    const batchData = batch.map((t) => ({
      id: t.id,
      description: t.description,
      amount: t.amount,
      type: t.type as 'income' | 'expense', // Safe because we filtered out transfers
    }));

    const prompt = buildCategorizationPrompt(batchData);

    try {
      // Call LLM (use model's default temperature)
      const response = await client.generate(
        options.baseUrl,
        options.model,
        prompt
      );

      // Parse response
      const results = parseCategorizationResponse(response);

      // Match results to original transactions
      for (const txn of batch) {
        const result = results.find((r) => r.id === txn.id);
        if (result) {
          allResults.push(result);
        } else {
          // Fallback: use keyword matching
          const fallbackCategory = categorizeByKeywords(txn);
          allResults.push({
            id: txn.id,
            category: fallbackCategory,
            confidence: 0.3,
          });
        }
      }
    } catch (error) {
      console.error(`[Categorizer] Batch ${i + 1} failed:`, error);
      // Fallback to keyword matching for entire batch
      for (const txn of batch) {
        const fallbackCategory = categorizeByKeywords(txn);
        allResults.push({
          id: txn.id,
          category: fallbackCategory,
          confidence: 0.3,
        });
      }
    }
  }

  // Final progress report
  options.onProgress?.({
    total: categorizableTransactions.length,
    processed: categorizableTransactions.length,
    current: 0,
  });

  return allResults;
}

/**
 * Fallback keyword-based categorization.
 */
export function categorizeByKeywords(transaction: Transaction): string {
  const description = transaction.description.toLowerCase();

  // Transfers don't have expense semantics - skip categorization
  if (transaction.type === "transfer") {
    return "transfer";
  }

  // Find matching category by keywords
  for (const category of DEFAULT_CATEGORIES) {
    // Skip if type doesn't match
    if (category.type !== "both" && category.type !== transaction.type) {
      continue;
    }

    for (const keyword of category.keywords) {
      if (description.includes(keyword.toLowerCase())) {
        return category.id;
      }
    }
  }

  // Default based on type
  if (transaction.type === "income") {
    return "income";
  }
  return "other";
}

/**
 * Apply categorization results to transactions.
 * Sets confidence-based flags.
 */
export function applyCategorizationResults(
  transactions: Transaction[],
  results: CategorizationResult[]
): Transaction[] {
  const resultsMap = new Map(results.map((r) => [r.id, r]));

  return transactions.map((txn) => {
    const result = resultsMap.get(txn.id);
    if (!result) {
      return txn;
    }

    // Determine if needs review based on confidence
    const needsReview = result.confidence < 0.85;

    return {
      ...txn,
      category: result.category,
      categoryConfidence: result.confidence,
      needsReview,
      categorizedBy: result.confidence >= 0.3 ? "ai" : "keyword",
    } as Transaction;
  });
}

/**
 * Get category info with icon component name.
 */
export function getCategoryInfo(categoryId: string): {
  name: string;
  icon: string;
  color: string;
} {
  const category = getCategoryById(categoryId);
  return {
    name: category?.name || "Unknown",
    icon: category?.icon || "HelpCircle",
    color: category?.color || "#6b7280",
  };
}
