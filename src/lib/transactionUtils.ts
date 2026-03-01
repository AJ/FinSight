/**
 * Transaction utility functions.
 */

import { Transaction } from "@/types";
import { getCategoryById } from "./categorization/categories";

/**
 * Generate a unique signature for a transaction based on its content.
 * Used for deduplication - two transactions with the same signature are considered duplicates.
 */
export function getTransactionSignature(t: {
  date: Date | string;
  amount: number;
  description: string;
}): string {
  const dateStr =
    t.date instanceof Date ? t.date.toISOString().split("T")[0] : new Date(t.date).toISOString().split("T")[0];
  const amountStr = Math.abs(t.amount).toFixed(2);
  const descStr = t.description.toLowerCase().trim().substring(0, 100);
  return `${dateStr}|${amountStr}|${descStr}`;
}

/**
 * Deduplicate transactions by their content signature.
 * Returns only transactions that don't already exist in the existing set.
 */
export function deduplicateTransactions(
  newTxns: Transaction[],
  existingTxns: Transaction[]
): Transaction[] {
  const existingSignatures = new Set(
    existingTxns.map((t) => getTransactionSignature(t))
  );
  return newTxns.filter((t) => !existingSignatures.has(getTransactionSignature(t)));
}

// ============================================================================
// Deprecated functions - use Transaction class getters instead
// ============================================================================

/**
 * @deprecated Use `transaction.category.type` directly.
 */
export function getCategoryType(
  transaction: Transaction
): "income" | "expense" | "excluded" {
  const category = getCategoryById(transaction.category.id);
  return category?.type ?? "expense";
}

/**
 * @deprecated Use `transaction.isIncome` instead.
 */
export function isIncome(transaction: Transaction): boolean {
  return getCategoryType(transaction) === "income";
}

/**
 * @deprecated Use `transaction.isExpense` instead.
 */
export function isExpense(transaction: Transaction): boolean {
  return getCategoryType(transaction) === "expense";
}

/**
 * @deprecated Use `transaction.isExcluded` instead.
 */
export function isExcluded(transaction: Transaction): boolean {
  return getCategoryType(transaction) === "excluded";
}
