/**
 * Direction of money flow from the account perspective.
 * - Credit: Money coming into the account (deposits, refunds, payments received)
 * - Debit: Money going out of the account (purchases, withdrawals, fees)
 */
export enum TransactionType {
  Credit = "credit",
  Debit = "debit",
}

/**
 * Flexible input type - accepts legacy formats (income/expense).
 */
export type TransactionTypeInput = TransactionType | 'income' | 'expense';

/**
 * Normalize a transaction type value to standard format.
 *
 * Accepts: "credit", "debit", "income", "expense" (case-insensitive)
 * Rejects: null, undefined, invalid strings, numbers, objects
 *
 * @param raw - The raw type value to normalize
 * @returns Normalized type or null if invalid
 *
 * @example
 * normalizeTransactionType("income")    // TransactionType.Credit
 * normalizeTransactionType("EXPENSE")  // TransactionType.Debit
 * normalizeTransactionType("invalid")  // null
 * normalizeTransactionType(null)       // null
 */
export function normalizeTransactionType(raw: unknown): TransactionType | null {
  if (raw === null || raw === undefined) {
    return null;
  }

  const value = String(raw).toLowerCase().trim();

  if (value === 'credit' || value === 'income') {
    return TransactionType.Credit;
  }

  if (value === 'debit' || value === 'expense') {
    return TransactionType.Debit;
  }

  // Invalid input - log for debugging
  console.warn(`[TransactionType] Invalid type: "${String(raw)}"`);
  return null;
}

/**
 * Normalize transaction type, throwing on invalid input.
 * Use when invalid types should fail fast.
 *
 * @throws Error if input is not a valid transaction type
 */
export function normalizeTransactionTypeStrict(raw: unknown): TransactionType {
  const result = normalizeTransactionType(raw);
  if (result === null) {
    throw new Error(
      `Invalid transaction type: "${String(raw)}". ` +
      `Expected: credit, debit, income, or expense.`
    );
  }
  return result;
}
