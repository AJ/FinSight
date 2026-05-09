import { describe, it, expect } from 'vitest';
import {
  CategorizeTransactionSchema,
  CategorizeRequestSchema,
  CategorizeResponseSchema,
  InsightsRequestSchema,
  InsightsResponseSchema,
  TransactionAnalyticsSchema,
  InsightSchema,
} from '@/lib/validation/llmApiSchemas';

describe('CategorizeTransactionSchema', () => {
  it('validates a complete transaction', () => {
    const result = CategorizeTransactionSchema.parse({
      id: 'txn-1',
      description: 'Grocery store',
      merchant: 'BigBasket',
      amount: 500,
      type: 'debit',
      sourceType: 'bank',
      transactionSubType: 'purchase',
      categoryId: 'groceries',
    });
    expect(result.id).toBe('txn-1');
    expect(result.amount).toBe(500);
    expect(result.type).toBe('debit');
  });

  it('normalizes "income" to "credit"', () => {
    const result = CategorizeTransactionSchema.parse({ id: 't1', amount: 100, type: 'income' });
    expect(result.type).toBe('credit');
  });

  it('normalizes "expense" to "debit"', () => {
    const result = CategorizeTransactionSchema.parse({ id: 't1', amount: 50, type: 'expense' });
    expect(result.type).toBe('debit');
  });

  it('parses string amount to number', () => {
    const result = CategorizeTransactionSchema.parse({ id: 't1', amount: '123.45', type: 'debit' });
    expect(result.amount).toBe(123.45);
  });

  it('defaults description to empty string', () => {
    const result = CategorizeTransactionSchema.parse({ id: 't1', amount: 10, type: 'debit' });
    expect(result.description).toBe('');
  });

  it('rejects missing id', () => {
    expect(() => CategorizeTransactionSchema.parse({ amount: 10, type: 'debit' })).toThrow();
  });

  it('rejects invalid type', () => {
    expect(() => CategorizeTransactionSchema.parse({ id: 't1', amount: 10, type: 'invalid' })).toThrow();
  });

  it('rejects non-numeric string amount', () => {
    expect(() => CategorizeTransactionSchema.parse({ id: 't1', amount: 'abc', type: 'debit' })).toThrow();
  });
});

describe('CategorizeRequestSchema', () => {
  it('validates a complete request', () => {
    const result = CategorizeRequestSchema.parse({
      transactions: [{ id: 't1', amount: 100, type: 'debit' }],
    });
    expect(result.transactions).toHaveLength(1);
    expect(result.provider).toBe('ollama');
  });

  it('rejects empty transactions array', () => {
    expect(() => CategorizeRequestSchema.parse({ transactions: [] })).toThrow();
  });

  it('defaults provider to ollama', () => {
    const result = CategorizeRequestSchema.parse({
      transactions: [{ id: 't1', amount: 100, type: 'debit' }],
    });
    expect(result.provider).toBe('ollama');
  });
});

describe('CategorizeResponseSchema', () => {
  it('validates a response', () => {
    const result = CategorizeResponseSchema.parse({
      results: [{ id: 't1', category: 'groceries', confidence: 0.9, source: 'ai' }],
    });
    expect(result.results).toHaveLength(1);
  });

  it('rejects confidence out of range', () => {
    expect(() => CategorizeResponseSchema.parse({
      results: [{ id: 't1', category: 'food', confidence: 1.5, source: 'ai' }],
    })).toThrow();
  });

  it('rejects invalid source', () => {
    expect(() => CategorizeResponseSchema.parse({
      results: [{ id: 't1', category: 'food', confidence: 0.5, source: 'invalid' }],
    })).toThrow();
  });
});

describe('TransactionAnalyticsSchema', () => {
  it('defaults totalTransactions to 0', () => {
    const result = TransactionAnalyticsSchema.parse({});
    expect(result.totalTransactions).toBe(0);
  });

  it('validates a complete analytics object', () => {
    const result = TransactionAnalyticsSchema.parse({
      totalTransactions: 50,
      dateRange: { start: '2024-01-01', end: '2024-12-31' },
      currentMonth: { income: 50000, expenses: 30000 },
    });
    expect(result.totalTransactions).toBe(50);
    expect(result.dateRange).toBeDefined();
  });
});

describe('InsightsRequestSchema', () => {
  const currency = { code: 'INR', symbol: '₹', name: 'Indian Rupee' };

  it('validates a minimal request with currency', () => {
    const result = InsightsRequestSchema.parse({
      analytics: {},
      currency,
    });
    expect(result.currency.code).toBe('INR');
    expect(result.provider).toBe('ollama');
  });

  it('rejects missing currency', () => {
    expect(() => InsightsRequestSchema.parse({ analytics: {} })).toThrow();
  });

  it('rejects invalid currency code length', () => {
    expect(() => InsightsRequestSchema.parse({
      analytics: {},
      currency: { code: 'INVALID', symbol: 'X', name: 'Test' },
    })).toThrow();
  });
});

describe('InsightSchema', () => {
  it('validates a category_trend insight', () => {
    const result = InsightSchema.parse({
      type: 'category_trend',
      title: 'Grocery spending up',
      description: 'Your grocery spending increased by 20% this month.',
      severity: 'warning',
      category: 'groceries',
    });
    expect(result.type).toBe('category_trend');
  });

  it('rejects title over 100 chars', () => {
    expect(() => InsightSchema.parse({
      type: 'anomaly',
      title: 'x'.repeat(101),
      description: 'd',
      severity: 'info',
    })).toThrow();
  });

  it('rejects invalid severity', () => {
    expect(() => InsightSchema.parse({
      type: 'anomaly',
      title: 't',
      description: 'd',
      severity: 'critical',
    })).toThrow();
  });
});

describe('InsightsResponseSchema', () => {
  it('validates a response with insights', () => {
    const result = InsightsResponseSchema.parse({
      insights: [{
        type: 'savings_opportunity',
        title: 'Save more',
        description: 'Cut dining expenses',
        severity: 'positive',
      }],
    });
    expect(result.insights).toHaveLength(1);
  });

  it('accepts empty insights array', () => {
    const result = InsightsResponseSchema.parse({ insights: [] });
    expect(result.insights).toHaveLength(0);
  });
});
