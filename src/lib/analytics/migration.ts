interface MigratableTransaction {
  category?: string | { id: string };
  transactionSubType?: string;
  description?: string;
  sourceType?: string;
  type?: string;
}

export interface MigrationResult {
  categoryId: string;
  transactionSubType: string;
  changed: boolean;
}

const CC_PAYMENT_PATTERNS = /\b(cc payment|credit card payment|card payment|credit card bill|card bill|billpay)\b/i;
const LOAN_PATTERNS = /\b(loan emi|loan repayment|personal loan|home loan|car loan|auto loan|emi)\b/i;

// Old subType values → consolidated values
const SUBTYPE_MIGRATIONS: Record<string, string> = {
  'bill_payment': 'debt_payment',
  'deposit': 'transfer',
  'transfer_in': 'transfer',
  'transfer_out': 'transfer',
  'cashback': 'rewards',
  'reversal': 'refund',
  'reimbursement': 'refund',
  'debt': 'debt_payment',
};

function getCategoryId(category: string | { id: string } | undefined): string {
  if (!category) return '';
  if (typeof category === 'string') return category;
  return category.id ?? '';
}

export function migrateTransactionCategories(txn: MigratableTransaction): MigrationResult {
  const categoryId = getCategoryId(txn.category);
  const subType = txn.transactionSubType ?? '';
  const desc = txn.description ?? '';
  const sourceType = txn.sourceType ?? '';
  const txnType = txn.type ?? '';

  // Already migrated (consolidated subTypes)
  if ((categoryId === 'cc_bill_payment' || categoryId === 'loans') && subType === 'debt_payment') {
    return { categoryId, transactionSubType: subType, changed: false };
  }
  if (categoryId === 'investment' && subType === 'investment') {
    return { categoryId, transactionSubType: subType, changed: false };
  }

  // CC bill payments stuck in 'bills' or other categories (fixes both category and subType)
  if (CC_PAYMENT_PATTERNS.test(desc)) {
    return { categoryId: 'cc_bill_payment', transactionSubType: 'debt_payment', changed: true };
  }

  // Loan/EMI payments stuck in 'bills'
  if (categoryId === 'bills' && LOAN_PATTERNS.test(desc)) {
    return { categoryId: 'loans', transactionSubType: 'debt_payment', changed: true };
  }

  // Investment category without investment subType
  if (categoryId === 'investment' && subType !== 'investment') {
    return { categoryId: 'investment', transactionSubType: 'investment', changed: true };
  }

  // SubType consolidation: migrate old subType values to new ones (category stays the same)
  if (subType && SUBTYPE_MIGRATIONS[subType]) {
    return { categoryId, transactionSubType: SUBTYPE_MIGRATIONS[subType], changed: true };
  }

  // CC debits without subType → assign 'purchase'
  if (sourceType === 'credit_card' && txnType === 'debit' && !subType) {
    return { categoryId, transactionSubType: 'purchase', changed: true };
  }

  // CC credits matching payment patterns without subType → assign 'debt_payment'
  if (sourceType === 'credit_card' && txnType === 'credit' && CC_PAYMENT_PATTERNS.test(desc) && !subType) {
    return { categoryId, transactionSubType: 'debt_payment', changed: true };
  }

  return { categoryId, transactionSubType: subType, changed: false };
}

// Salary/income patterns for category restoration
const SALARY_PATTERNS = /\b(salary|payroll|wages|income|freelance|consulting|commission|bonus)\b/i;

/**
 * Restore category for transactions corrupted by the buggy v3 migration
 * (which wiped categories to '' for transactions with old subTypes).
 *
 * Returns the restored category ID, or '' if no inference possible.
 */
export function restoreCorruptedCategory(txn: {
  category?: string;
  transactionSubType?: string;
  description?: string;
  sourceType?: string;
  type?: string;
}): string {
  const category = typeof txn.category === 'string' ? txn.category : txn.category ?? '';
  const subType = txn.transactionSubType ?? '';
  const desc = txn.description ?? '';
  const sourceType = txn.sourceType ?? '';
  const txnType = txn.type ?? '';

  // Only fix transactions with empty/falsy category
  if (category && category !== '') return category;

  // Description-based inference
  if (CC_PAYMENT_PATTERNS.test(desc)) return 'cc_bill_payment';
  if (LOAN_PATTERNS.test(desc)) return 'loans';
  if (subType === 'investment') return 'investment';
  if (SALARY_PATTERNS.test(desc)) return 'income';

  // Bank credits without category → likely income
  if (sourceType === 'bank' && txnType === 'credit') return 'salary';

  // Bank debits: subType gives a hint
  if (sourceType === 'bank' && txnType === 'debit') {
    if (subType === 'debt_payment') return 'cc_bill_payment';
    if (subType === 'purchase') return 'shopping';
  }

  // No reliable inference → leave as 'other'
  return 'other';
}
