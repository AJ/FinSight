/**
 * Valid transaction type values used throughout the app.
 */
export type TransactionType = 'credit' | 'debit';

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
 * normalizeTransactionType("income")    // "credit"
 * normalizeTransactionType("EXPENSE")  // "debit"
 * normalizeTransactionType("invalid")  // null
 * normalizeTransactionType(null)       // null
 */
export function normalizeTransactionType(raw: unknown): TransactionType | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  
  const value = String(raw).toLowerCase().trim();
  
  if (value === 'credit' || value === 'income') {
    return 'credit';
  }
  
  if (value === 'debit' || value === 'expense') {
    return 'debit';
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
