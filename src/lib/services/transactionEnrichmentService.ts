import { normalizeMerchantName } from "@/lib/categorizer";
import { applyCategorizationResults, categorizeTransactions } from "@/lib/categorization/aiCategorizer";
import type { CategorizationOptions } from "@/lib/categorization/aiCategorizer";
import { Transaction } from "@/types";

function withNormalizedMerchant(transaction: Transaction): Transaction {
  return Transaction.fromJSON({
    ...transaction.toJSON(),
    merchant: normalizeMerchantName(transaction.merchant || transaction.description),
  });
}

function mergeTransactionsById(
  baseTransactions: Transaction[],
  updatedTransactions: Transaction[],
): Transaction[] {
  const updatedById = new Map(updatedTransactions.map((transaction) => [transaction.id, transaction]));
  return baseTransactions.map((transaction) => updatedById.get(transaction.id) ?? transaction);
}

export async function enrichImportedTransactions(
  transactions: Transaction[],
  options: CategorizationOptions,
): Promise<Transaction[]> {
  if (transactions.length === 0) {
    return [];
  }

  const normalizedTransactions = transactions.map(withNormalizedMerchant);
  const results = await categorizeTransactions(normalizedTransactions, options);
  return applyCategorizationResults(normalizedTransactions, results);
}

export async function recategorizeStoredTransactions(
  transactions: Transaction[],
  options: CategorizationOptions,
): Promise<Transaction[]> {
  if (transactions.length === 0) {
    return [];
  }

  const normalizedTransactions = transactions.map(withNormalizedMerchant);
  const results = await categorizeTransactions(normalizedTransactions, options);
  return applyCategorizationResults(normalizedTransactions, results);
}

export function mergeRecategorizedTransactions(
  allTransactions: Transaction[],
  recategorizedTransactions: Transaction[],
): Transaction[] {
  return mergeTransactionsById(allTransactions, recategorizedTransactions);
}
