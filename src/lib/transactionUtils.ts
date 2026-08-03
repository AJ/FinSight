/**
 * Transaction utility functions.
 */

import { Transaction, TransactionType } from "@/types";

/**
 * Generate a unique signature for a transaction based on its content.
 * Used for deduplication - two transactions with the same signature are considered duplicates.
 *
 * `type` is part of the signature so a credit and a debit that share a date, amount,
 * and description are not treated as the same transaction. Direction lives in `type`,
 * not the amount sign: amounts are always positive at runtime, so a sign-based check
 * would never distinguish them.
 */
export function getTransactionSignature(t: {
  date: Date | string;
  amount: number;
  description: string;
  type: TransactionType;
}): string {
  const dateStr =
    t.date instanceof Date ? t.date.toISOString().split("T")[0] : new Date(t.date).toISOString().split("T")[0];
  const amountStr = t.amount.toFixed(2);
  const descStr = t.description.toLowerCase().trim().substring(0, 100);
  return `${dateStr}|${t.type}|${amountStr}|${descStr}`;
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
