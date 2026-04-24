import { describe, it, expect } from 'vitest';
import { Transaction, TransactionType, Category, CategoryType, SourceType } from '@/types';
import '@/lib/categorization/categories';

function makeCategory(id: string): Category {
  return new Category(id, id, CategoryType.Expense);
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
