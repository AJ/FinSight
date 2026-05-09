/**
 * Test factories — reusable builders for creating test fixtures.
 *
 * All Transaction instances are created via Transaction.fromExtracted()
 * to ensure fully-initialized objects matching production construction paths.
 */

import { v4 as uuidv4 } from 'uuid';
import {
  Transaction,
  Category,
  CategoryType,
  SourceType,
} from '@/types';
import type { CategorizedBy } from '@/models/CategorizedBy';
import type { AnomalyType } from '@/models/AnomalyType';
import type { AnomalyDetails } from '@/models/AnomalyDetails';
import type { Currency } from '@/types';
import type { ExtractedTransaction } from '@/types/extractedTransaction';
import '@/lib/categorization/categories'; // Populate category registry for Category.fromId()

// ─── Transaction Factory ───────────────────────────────────────────────────

const DEFAULT_CURRENCY: Currency = { code: 'INR', symbol: '₹', name: 'Indian Rupee' };

interface MakeTransactionInput {
  // ExtractedTransaction fields (passed to fromExtracted)
  id?: string;
  date?: string | Date;
  description?: string;
  amount?: number;
  type?: 'debit' | 'credit';
  transactionSubType?: string;
  balance?: number | null;
  localCurrency?: string;
  isInternationalTransaction?: boolean;
  originalCurrency?: string;
  originalAmount?: number;
  confidence?: number;
  // Overrides applied after construction (mutable fields)
  category?: Category;
  categoryConfidence?: number;
  needsReview?: boolean;
  categorizedBy?: CategorizedBy;
  isAnomaly?: boolean;
  anomalyTypes?: AnomalyType[];
  anomalyDetails?: AnomalyDetails;
  anomalyDismissed?: boolean;
  // Construction parameters
  sourceType?: SourceType;
  currency?: Currency;
  // Post-construction overrides (readonly fields via Object.defineProperty)
  merchant?: string;
  sourceFileHash?: string;
}

/**
 * Create a real Transaction instance via Transaction.fromExtracted().
 * All 28 constructor fields are properly initialized.
 */
export function makeTransaction(input: MakeTransactionInput = {}): Transaction {
  const dateValue = input.date instanceof Date
    ? input.date.toISOString().split('T')[0]
    : input.date ?? '2024-01-15';

  const extracted: ExtractedTransaction = {
    date: dateValue,
    description: input.description ?? 'Test Transaction',
    amount: input.amount ?? 100,
    type: input.type ?? 'debit',
    transactionSubType: input.transactionSubType,
    balance: input.balance ?? null,
    localCurrency: input.localCurrency,
    isInternationalTransaction: input.isInternationalTransaction,
    originalCurrency: input.originalCurrency,
    originalAmount: input.originalAmount,
    confidence: input.confidence,
  };

  const txn = Transaction.fromExtracted(
    extracted,
    input.currency ?? DEFAULT_CURRENCY,
    input.sourceType ?? SourceType.Bank,
  );

  // Override id (readonly, but fromExtracted always generates uuid —
  // tests often need deterministic IDs for assertions)
  if (input.id) {
    Object.defineProperty(txn, 'id', { value: input.id, writable: true });
  }
  // Override date if a Date object was provided (fromExtracted parses string → Date)
  if (input.date instanceof Date) {
    Object.defineProperty(txn, 'date', { value: input.date, writable: true });
  }

  // Default category: 'shopping' (Expense). fromExtracted() assigns 'other' (Excluded),
  // which causes isExpense to return false and silently drops transactions from most
  // analytics functions. Tests expect expense transactions by default.
  txn.category = input.category ?? makeCategory('shopping');
  if (input.categoryConfidence !== undefined) txn.categoryConfidence = input.categoryConfidence;
  if (input.needsReview !== undefined) txn.needsReview = input.needsReview;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- readonly field override for test setup
  if (input.categorizedBy !== undefined) txn.categorizedBy = input.categorizedBy as any;
  if (input.isAnomaly !== undefined) txn.isAnomaly = input.isAnomaly;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- readonly field override for test setup
  if (input.anomalyTypes !== undefined) txn.anomalyTypes = input.anomalyTypes as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- readonly field override for test setup
  if (input.anomalyDetails !== undefined) txn.anomalyDetails = input.anomalyDetails as any;
  if (input.anomalyDismissed !== undefined) txn.anomalyDismissed = input.anomalyDismissed;
  if (input.merchant !== undefined) Object.defineProperty(txn, 'merchant', { value: input.merchant, writable: true });
  if (input.sourceFileHash !== undefined) Object.defineProperty(txn, 'sourceFileHash', { value: input.sourceFileHash, writable: true });

  return txn;
}

export function makeTransactions(count: number, overrides?: Partial<MakeTransactionInput>): Transaction[] {
  return Array.from({ length: count }, (_, i) =>
    makeTransaction({
      id: `txn-${i}`,
      description: `Transaction ${i + 1}`,
      amount: 100 + i * 50,
      date: new Date(2024, 0, 1 + i),
      ...overrides,
    })
  );
}

// ─── Category Helper ───────────────────────────────────────────────────────

export function makeCategory(id: string, type: CategoryType = CategoryType.Expense): Category {
  return new Category(id, id, type);
}

// ─── Extracted Transaction Factory (LLM output DTO) ────────────────────────

interface MakeExtractedTransactionInput {
  date?: string;
  description?: string;
  amount?: number;
  type?: 'credit' | 'debit';
  transactionSubType?: string;
  balance?: number | null;
  localCurrency?: string;
  originalCurrency?: string;
  originalAmount?: number;
  confidence?: number;
}

export function makeExtractedTransaction(input: MakeExtractedTransactionInput = {}): ExtractedTransaction {
  return {
    date: input.date ?? '2024-01-15',
    description: input.description ?? 'Test Transaction',
    amount: input.amount ?? 100,
    type: input.type ?? 'debit',
    transactionSubType: input.transactionSubType ?? 'purchase',
    balance: input.balance ?? null,
    localCurrency: input.localCurrency ?? 'INR',
    originalCurrency: input.originalCurrency ?? undefined,
    originalAmount: input.originalAmount ?? undefined,
    confidence: input.confidence ?? 0.9,
  };
}

// ─── Summary Factories ─────────────────────────────────────────────────────

export function makeCCSummary(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    statementDate: '2024-01-31',
    statementPeriodStart: '2024-01-01',
    statementPeriodEnd: '2024-01-31',
    creditLimit: 100000,
    totalDue: 25000,
    minimumDue: 2500,
    availableCredit: 75000,
    previousBalance: 30000,
    cashAdvance: null,
    financeCharge: null,
    latePaymentFee: null,
    overlimitFee: null,
    otherFeesAndCharges: null,
    purchasesAndCharges: 20000,
    totalCredits: 25000,
    cashAdvanceLimit: null,
    cardNumber: null,
    totalAmountDue: null,
    rewards: null,
    ...overrides,
  };
}

export function makeBankSummary(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    statementDate: '2024-01-31',
    statementPeriodStart: '2024-01-01',
    statementPeriodEnd: '2024-01-31',
    openingBalance: 50000,
    closingBalance: 75000,
    ...overrides,
  };
}

// ─── Merchant Rule Factory ─────────────────────────────────────────────────

export function makeMerchantRule(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    merchantKey: 'AMAZON',
    categoryVotes: { shopping: 5 },
    activeCategoryId: 'shopping',
    status: 'confident',
    lastConfirmedAt: '2024-01-15T10:00:00.000Z',
    direction: null,
    sourceType: null,
    specificityScore: 1,
    ...overrides,
  };
}

// ─── Credit Card Statement Factory ─────────────────────────────────────────

export function makeCreditCardStatement(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: uuidv4(),
    issuer: 'HDFC',
    cardNumber: '**** 1234',
    statementDate: '2024-01-31',
    statementPeriodStart: '2024-01-01',
    statementPeriodEnd: '2024-01-31',
    creditLimit: 100000,
    totalDue: 25000,
    minimumDue: 2500,
    availableCredit: 75000,
    previousBalance: 30000,
    isPaid: false,
    paidDate: null,
    paidAmount: null,
    transactionCount: 12,
    ...overrides,
  };
}

// ─── Recurring Payment Factory ─────────────────────────────────────────────

export function makeRecurringPayment(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: uuidv4(),
    merchantName: 'NETFLIX',
    normalizedName: 'netflix',
    amount: 649,
    frequency: 'monthly' as const,
    status: 'active' as const,
    confidence: 0.95,
    firstSeen: new Date('2023-06-01'),
    lastSeen: new Date('2024-01-01'),
    nextPredicted: new Date('2024-02-01'),
    occurrenceCount: 8,
    ...overrides,
  };
}

// ─── File Factory ──────────────────────────────────────────────────────────

/**
 * Creates a mock File object from a Blob with the given name and type.
 */
export function makeFile(content: string, name: string, type?: string): File {
  const blob = new Blob([content], type ? { type } : undefined);
  const file = new File([blob], name, type ? { type } : undefined);
  return file;
}

/**
 * Creates a mock File from a CSV content string.
 */
export function makeCsvFile(content: string): File {
  return makeFile(content, 'test.csv', 'text/csv');
}

// ─── Budget Factory ────────────────────────────────────────────────────────

export function makeBudget(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: uuidv4(),
    name: 'January 2024 Budget',
    totalIncome: 50000,
    allocations: [
      { categoryId: 'dining', amount: 5000 },
      { categoryId: 'groceries', amount: 10000 },
    ],
    createdAt: new Date('2024-01-01'),
    ...overrides,
  };
}

// ─── Anomaly Factory ───────────────────────────────────────────────────────

export function makeAnomalyDetail(type: string, txnId: string, overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    type,
    transactionId: txnId,
    zScore: type === 'high_amount' ? 3.5 : type === 'low_amount' ? -2.5 : null,
    duplicateOf: type === 'duplicate' ? 'other-txn-id' : null,
    frequencyCount: type === 'unusual_frequency' ? 5 : null,
    frequencyPeriod: type === 'unusual_frequency' ? '7d' : null,
    ...overrides,
  };
}

// ─── Budget Factories ──────────────────────────────────────────────────────

export function makeBudgetPeriod(overrides?: Partial<import('@/types').BudgetPeriod>): import('@/types').BudgetPeriod {
  return {
    month: '2026-04',
    income: 50000,
    allocations: [
      { categoryId: 'groceries', amount: 10000 },
      { categoryId: 'dining', amount: 5000 },
    ],
    hiddenCategories: [],
    createdAt: new Date('2026-04-01').toISOString(),
    updatedAt: new Date('2026-04-01').toISOString(),
    ...overrides,
  };
}

export function makeBudgetProgress(overrides?: Partial<import('@/types').BudgetProgress>): import('@/types').BudgetProgress {
  return {
    categoryId: 'groceries',
    budgeted: 10000,
    spent: 5000,
    remaining: 5000,
    percentUsed: 50,
    status: 'on-track',
    ...overrides,
  };
}
