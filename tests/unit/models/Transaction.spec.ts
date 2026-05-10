import { describe, it, expect } from 'vitest';
import { Transaction, TransactionType, Category, CategoryType, SourceType, CategorizedBy } from '@/types';
import { formatSubType, TRANSACTION_SUB_TYPES } from '@/models/Transaction';
import '@/lib/categorization/categories';

function makeCategory(id: string, type: CategoryType = CategoryType.Expense): Category {
  return new Category(id, id, type);
}

describe('Transaction.fromExtracted', () => {
  const inrCurrency = { code: 'INR', symbol: '₹', name: 'Indian Rupee' };

  it('creates with UUID', () => {
    const txn = Transaction.fromExtracted({
      date: '2024-01-15', description: 'Test', amount: 100, type: 'debit',
      balance: null, localCurrency: 'INR', confidence: 0.9,
    }, inrCurrency, SourceType.Bank);
    expect(txn.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });

  it('parses date string', () => {
    const txn = Transaction.fromExtracted({
      date: '2024-01-15', description: 'Test', amount: 100, type: 'debit',
      balance: null, localCurrency: 'INR', confidence: 0.9,
    }, inrCurrency, SourceType.Bank);
    expect(txn.date).toEqual(new Date('2024-01-15'));
  });

  it('stores absolute amount', () => {
    const txn = Transaction.fromExtracted({
      date: '2024-01-15', description: 'Test', amount: -1299, type: 'debit',
      balance: null, localCurrency: 'INR', confidence: 0.9,
    }, inrCurrency, SourceType.Bank);
    expect(txn.amount).toBe(1299);
  });

  it('maps credit type', () => {
    const txn = Transaction.fromExtracted({
      date: '2024-01-15', description: 'Test', amount: 100, type: 'credit',
      balance: null, localCurrency: 'INR', confidence: 0.9,
    }, inrCurrency, SourceType.Bank);
    expect(txn.type).toBe(TransactionType.Credit);
  });

  it('maps debit type', () => {
    const txn = Transaction.fromExtracted({
      date: '2024-01-15', description: 'Test', amount: 100, type: 'debit',
      balance: null, localCurrency: 'INR', confidence: 0.9,
    }, inrCurrency, SourceType.Bank);
    expect(txn.type).toBe(TransactionType.Debit);
  });

  it('defaults category to other', () => {
    const txn = Transaction.fromExtracted({
      date: '2024-01-15', description: 'Test', amount: 100, type: 'debit',
      balance: null, localCurrency: 'INR', confidence: 0.9,
    }, inrCurrency, SourceType.Bank);
    expect(txn.category.id).toBe('other');
  });

  it('maps payment subType to bill_payment', () => {
    const txn = Transaction.fromExtracted({
      date: '2024-01-15', description: 'Test', amount: 100, type: 'debit',
      balance: null, localCurrency: 'INR', transactionSubType: 'payment', confidence: 0.9,
    }, inrCurrency, SourceType.Bank);
    expect(txn.transactionSubType).toBe('bill_payment');
  });

  it('preserves other subtypes', () => {
    const txn = Transaction.fromExtracted({
      date: '2024-01-15', description: 'Test', amount: 100, type: 'debit',
      balance: null, localCurrency: 'INR', transactionSubType: 'purchase', confidence: 0.9,
    }, inrCurrency, SourceType.Bank);
    expect(txn.transactionSubType).toBe('purchase');
  });

  it('sets sourceType', () => {
    const txn = Transaction.fromExtracted({
      date: '2024-01-15', description: 'Test', amount: 100, type: 'debit',
      balance: null, localCurrency: 'INR', confidence: 0.9,
    }, inrCurrency, SourceType.CreditCard);
    expect(txn.sourceType).toBe(SourceType.CreditCard);
  });

  it('uses settings currency when extracted has no localCurrency', () => {
    const txn = Transaction.fromExtracted({
      date: '2024-01-15', description: 'Test', amount: 100, type: 'debit',
      balance: null, localCurrency: null as unknown as string, confidence: 0.9,
    }, inrCurrency, SourceType.Bank);
    expect(txn.localCurrency).toEqual(inrCurrency);
  });

  it('uses extracted localCurrency when present', () => {
    const txn = Transaction.fromExtracted({
      date: '2024-01-15', description: 'Test', amount: 100, type: 'debit',
      balance: null, localCurrency: 'USD', confidence: 0.9,
    }, inrCurrency, SourceType.Bank);
    expect(txn.localCurrency.code).toBe('USD');
  });

  it('falls back to settingsCurrency for unrecognized currency code', () => {
    const txn = Transaction.fromExtracted({
      date: '2024-01-15', description: 'Test', amount: 100, type: 'debit',
      balance: null, localCurrency: 'ZZZ', confidence: 0.9,
    }, inrCurrency, SourceType.Bank);
    expect(txn.localCurrency).toEqual(inrCurrency);
  });

  it('stores originalAmount for international transactions', () => {
    const txn = Transaction.fromExtracted({
      date: '2024-01-15', description: 'Test', amount: 100, type: 'debit',
      balance: null, localCurrency: 'INR', originalAmount: 1.20, confidence: 0.9,
    }, inrCurrency, SourceType.Bank);
    expect(txn.originalAmount).toBe(1.20);
  });

  it('sets isInternational from extracted flag', () => {
    const txn = Transaction.fromExtracted({
      date: '2024-01-15', description: 'Test', amount: 100, type: 'debit',
      balance: null, localCurrency: 'INR', isInternationalTransaction: true, confidence: 0.9,
    }, inrCurrency, SourceType.Bank);
    expect(txn.isInternational).toBe(true);
  });

  it('maps confidence to llmConfidence', () => {
    const txn = Transaction.fromExtracted({
      date: '2024-01-15', description: 'Test', amount: 100, type: 'debit',
      balance: null, localCurrency: 'INR', confidence: 0.95,
    }, inrCurrency, SourceType.Bank);
    expect(txn.llmConfidence).toBe(0.95);
  });

  it('stores extracted description as originalText', () => {
    const txn = Transaction.fromExtracted({
      date: '2024-01-15', description: 'AMAZON INDIA PVT LTD', amount: 500, type: 'debit',
      balance: null, localCurrency: 'INR', confidence: 0.9,
    }, inrCurrency, SourceType.Bank);
    expect(txn.originalText).toBe('AMAZON INDIA PVT LTD');
  });
});

describe('Transaction.toJSON', () => {
  it('serializes Date to ISO string', () => {
    const txn = new Transaction(
      '1', new Date('2024-01-15'), 'Test', 100, TransactionType.Debit,
      makeCategory('shopping')
    );
    const json = txn.toJSON();
    expect(json.date).toBe('2024-01-15T00:00:00.000Z');
  });
});

describe('Transaction.fromJSON', () => {
  it('deserializes from JSON with Date rehydration', () => {
    const json = {
      id: '1', date: '2024-01-15T00:00:00.000Z', description: 'Test', amount: 100,
      type: TransactionType.Debit, category: 'shopping', localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
      isInternational: false,
    };
    const txn = Transaction.fromJSON(json);
    expect(txn.date).toEqual(new Date('2024-01-15T00:00:00.000Z'));
  });
});

describe('Transaction.sourceFileHash', () => {
  const hash = 'abc123def456';

  it('toJSON includes sourceFileHash when set', () => {
    const txn = new Transaction(
      '1', new Date('2024-01-15'), 'Test', 100, TransactionType.Debit,
      makeCategory('shopping'),
      undefined, // balance
      undefined, // merchant
      undefined, // originalText
      undefined, // budgetMonth
      undefined, // categoryConfidence
      undefined, // needsReview
      undefined, // categorizedBy
      undefined, // sourceType
      undefined, // statementId
      undefined, // cardIssuer
      undefined, // cardLastFour
      undefined, // cardHolder
      { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, // localCurrency
      undefined, // originalCurrency
      undefined, // originalAmount
      false,     // isInternational
      undefined, // isAnomaly
      undefined, // anomalyTypes
      undefined, // anomalyDetails
      undefined, // anomalyDismissed
      undefined, // transactionSubType
      undefined, // suggestedCategory
      undefined, // llmConfidence
      undefined, // verificationConfidence
      hash,      // sourceFileHash
    );
    expect(txn.toJSON().sourceFileHash).toBe(hash);
  });

  it('fromJSON restores sourceFileHash', () => {
    const json = {
      id: '1', date: '2024-01-15T00:00:00.000Z', description: 'Test', amount: 100,
      type: TransactionType.Debit, category: 'shopping',
      localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
      isInternational: false,
      sourceFileHash: hash,
    };
    const txn = Transaction.fromJSON(json);
    expect(txn.sourceFileHash).toBe(hash);
  });

  it('sourceFileHash defaults to undefined when not provided', () => {
    const json = {
      id: '1', date: '2024-01-15T00:00:00.000Z', description: 'Test', amount: 100,
      type: TransactionType.Debit, category: 'shopping',
      localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
      isInternational: false,
    };
    const txn = Transaction.fromJSON(json);
    expect(txn.sourceFileHash).toBeUndefined();
  });

  it('cloneWith preserves sourceFileHash', () => {
    const json = {
      id: '1', date: '2024-01-15T00:00:00.000Z', description: 'Test', amount: 100,
      type: TransactionType.Debit, category: 'shopping',
      localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
      isInternational: false,
      sourceFileHash: hash,
    };
    const txn = Transaction.fromJSON(json);
    const cloned = txn.cloneWith({ description: 'Updated' });
    expect(cloned.sourceFileHash).toBe(hash);
    expect(cloned.description).toBe('Updated');
  });
});

// ── Getters ────────────────────────────────────────────────────────────────

describe('Transaction getters', () => {
  it('signedAmount is negative for debits', () => {
    const txn = new Transaction('1', new Date(), 'T', 100, TransactionType.Debit, makeCategory('food'));
    expect(txn.signedAmount).toBe(-100);
  });

  it('signedAmount is positive for credits', () => {
    const txn = new Transaction('1', new Date(), 'T', 100, TransactionType.Credit, makeCategory('salary', CategoryType.Income));
    expect(txn.signedAmount).toBe(100);
  });

  it('isCredit is true for Credit type', () => {
    const txn = new Transaction('1', new Date(), 'T', 100, TransactionType.Credit, makeCategory('salary', CategoryType.Income));
    expect(txn.isCredit).toBe(true);
    expect(txn.isDebit).toBe(false);
  });

  it('isDebit is true for Debit type', () => {
    const txn = new Transaction('1', new Date(), 'T', 100, TransactionType.Debit, makeCategory('food'));
    expect(txn.isDebit).toBe(true);
    expect(txn.isCredit).toBe(false);
  });

  it('isIncome delegates to category', () => {
    const txn = new Transaction('1', new Date(), 'T', 100, TransactionType.Credit, makeCategory('salary', CategoryType.Income));
    expect(txn.isIncome).toBe(true);
  });

  it('isExpense delegates to category', () => {
    const txn = new Transaction('1', new Date(), 'T', 100, TransactionType.Debit, makeCategory('food'));
    expect(txn.isExpense).toBe(true);
  });

  it('isExcluded delegates to category', () => {
    const txn = new Transaction('1', new Date(), 'T', 100, TransactionType.Debit, makeCategory('transfer', CategoryType.Excluded));
    expect(txn.isExcluded).toBe(true);
  });
});

// ── fromJSON edge cases ────────────────────────────────────────────────────

describe('Transaction.fromJSON edge cases', () => {
  it('falls back to default category for unknown ID', () => {
    const json = {
      id: '1', date: '2024-01-15T00:00:00.000Z', description: 'T', amount: 100,
      type: TransactionType.Debit, category: 'nonexistent_category',
      localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
      isInternational: false,
    };
    const txn = Transaction.fromJSON(json);
    expect(txn.category.id).toBe('other');
  });

  it('defaults localCurrency to INR when missing', () => {
    const json = {
      id: '1', date: '2024-01-15T00:00:00.000Z', description: 'T', amount: 100,
      type: TransactionType.Debit, category: 'food',
      isInternational: false,
    };
    const txn = Transaction.fromJSON(json as Parameters<typeof Transaction.fromJSON>[0]);
    expect(txn.localCurrency.code).toBe('INR');
  });

  it('defaults isInternational to false when missing', () => {
    const json = {
      id: '1', date: '2024-01-15T00:00:00.000Z', description: 'T', amount: 100,
      type: TransactionType.Debit, category: 'food',
      localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
    };
    const txn = Transaction.fromJSON(json as Parameters<typeof Transaction.fromJSON>[0]);
    expect(txn.isInternational).toBe(false);
  });

  it('takes absolute value of amount', () => {
    const json = {
      id: '1', date: '2024-01-15T00:00:00.000Z', description: 'T', amount: -500,
      type: TransactionType.Debit, category: 'food',
      localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
      isInternational: false,
    };
    const txn = Transaction.fromJSON(json);
    expect(txn.amount).toBe(500);
  });
});

// ── toJSON/fromJSON roundtrip ────────────────────────────────────────────────

describe('Transaction toJSON/fromJSON roundtrip', () => {
  it('preserves all fields through serialization cycle', () => {
    const original = new Transaction(
      'test-id',
      new Date('2024-06-15'),
      'Amazon Purchase',
      2499.99,
      TransactionType.Debit,
      makeCategory('shopping'),
      50000,          // balance
      'Amazon India', // merchant
      'AMAZON INDIA', // originalText
      '2024-06',      // budgetMonth
      0.92,           // categoryConfidence
      true,           // needsReview
      CategorizedBy.AI, // categorizedBy
      SourceType.CreditCard, // sourceType
      'stmt-001',     // statementId
      'Visa',         // cardIssuer
      '4242',         // cardLastFour
      'John Doe',     // cardHolder
      { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
      { code: 'USD', symbol: '$', name: 'US Dollar' }, // originalCurrency
      30.00,          // originalAmount
      true,           // isInternational
      false,          // isAnomaly
      undefined,      // anomalyTypes
      undefined,      // anomalyDetails
      undefined,      // anomalyDismissed
      'purchase',     // transactionSubType
      'shopping',     // suggestedCategory
      0.95,           // llmConfidence
      0.88,           // verificationConfidence
      'sha256hash',   // sourceFileHash
    );

    const json = original.toJSON();
    const restored = Transaction.fromJSON(json);

    expect(restored.id).toBe('test-id');
    expect(restored.date).toEqual(new Date('2024-06-15'));
    expect(restored.description).toBe('Amazon Purchase');
    expect(restored.amount).toBe(2499.99);
    expect(restored.type).toBe(TransactionType.Debit);
    expect(restored.category.id).toBe('shopping');
    expect(restored.balance).toBe(50000);
    expect(restored.merchant).toBe('Amazon India');
    expect(restored.originalText).toBe('AMAZON INDIA');
    expect(restored.budgetMonth).toBe('2024-06');
    expect(restored.categoryConfidence).toBe(0.92);
    expect(restored.needsReview).toBe(true);
    expect(restored.categorizedBy).toBe('ai');
    expect(restored.sourceType).toBe(SourceType.CreditCard);
    expect(restored.statementId).toBe('stmt-001');
    expect(restored.cardIssuer).toBe('Visa');
    expect(restored.cardLastFour).toBe('4242');
    expect(restored.cardHolder).toBe('John Doe');
    expect(restored.localCurrency.code).toBe('INR');
    expect(restored.originalCurrency!.code).toBe('USD');
    expect(restored.originalAmount).toBe(30.00);
    expect(restored.isInternational).toBe(true);
    expect(restored.transactionSubType).toBe('purchase');
    expect(restored.suggestedCategory).toBe('shopping');
    expect(restored.llmConfidence).toBe(0.95);
    expect(restored.verificationConfidence).toBe(0.88);
    expect(restored.sourceFileHash).toBe('sha256hash');
  });
});

// ── formatSubType ──────────────────────────────────────────────────────────

describe('formatSubType', () => {
  it('capitalizes first letter', () => {
    expect(formatSubType('purchase')).toBe('Purchase');
  });

  it('replaces underscores with spaces', () => {
    expect(formatSubType('bill_payment')).toBe('Bill payment');
  });

  it('handles multi-underscore types', () => {
    expect(formatSubType('transfer_in')).toBe('Transfer in');
  });

  it('returns empty string for empty input', () => {
    expect(formatSubType('')).toBe('');
  });
});

// ── TRANSACTION_SUB_TYPES ──────────────────────────────────────────────────

describe('TRANSACTION_SUB_TYPES', () => {
  it('is a non-empty readonly array', () => {
    expect(TRANSACTION_SUB_TYPES.length).toBeGreaterThan(0);
  });

  it('contains expected sub-types', () => {
    expect(TRANSACTION_SUB_TYPES).toContain('purchase');
    expect(TRANSACTION_SUB_TYPES).toContain('bill_payment');
    expect(TRANSACTION_SUB_TYPES).toContain('refund');
    expect(TRANSACTION_SUB_TYPES).toContain('fee');
    expect(TRANSACTION_SUB_TYPES).toContain('transfer_in');
    expect(TRANSACTION_SUB_TYPES).toContain('transfer_out');
  });
});
