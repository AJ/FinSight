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

  it('passes "credit" type through unchanged', () => {
    const result = CategorizeTransactionSchema.parse({ id: 't1', amount: 10, type: 'credit' });
    expect(result.type).toBe('credit');
  });

  it('passes "transfer" type through unchanged', () => {
    const result = CategorizeTransactionSchema.parse({ id: 't1', amount: 10, type: 'transfer' });
    expect(result.type).toBe('transfer');
  });

  it('strips unrecognized fields', () => {
    const result = CategorizeTransactionSchema.parse({
      id: 't1',
      amount: 10,
      type: 'debit',
      extraField: 'should be removed',
    });
    expect((result as Record<string, unknown>).extraField).toBeUndefined();
  });

  it('accepts negative amounts', () => {
    const result = CategorizeTransactionSchema.parse({ id: 't1', amount: -50, type: 'debit' });
    expect(result.amount).toBe(-50);
  });

  it('accepts zero amount', () => {
    const result = CategorizeTransactionSchema.parse({ id: 't1', amount: 0, type: 'debit' });
    expect(result.amount).toBe(0);
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

  it('accepts lmstudio provider', () => {
    const result = CategorizeRequestSchema.parse({
      transactions: [{ id: 't1', amount: 100, type: 'debit' }],
      provider: 'lmstudio',
    });
    expect(result.provider).toBe('lmstudio');
  });

  it('defaults baseUrl to DEFAULT_URLS.ollama', () => {
    const result = CategorizeRequestSchema.parse({
      transactions: [{ id: 't1', amount: 100, type: 'debit' }],
    });
    expect(result.baseUrl).toContain('localhost');
  });

  it('accepts custom baseUrl', () => {
    const result = CategorizeRequestSchema.parse({
      transactions: [{ id: 't1', amount: 100, type: 'debit' }],
      baseUrl: 'http://custom:8080',
    });
    expect(result.baseUrl).toBe('http://custom:8080');
  });

  it('rejects invalid baseUrl', () => {
    expect(() => CategorizeRequestSchema.parse({
      transactions: [{ id: 't1', amount: 100, type: 'debit' }],
      baseUrl: 'not-a-url',
    })).toThrow();
  });

  it('accepts optional model', () => {
    const result = CategorizeRequestSchema.parse({
      transactions: [{ id: 't1', amount: 100, type: 'debit' }],
      model: 'llama3',
    });
    expect(result.model).toBe('llama3');
  });

  it('applies transaction-level transforms within the array', () => {
    const result = CategorizeRequestSchema.parse({
      transactions: [
        { id: 't1', amount: '50', type: 'income' },
        { id: 't2', amount: 100, type: 'expense' },
      ],
    });
    expect(result.transactions[0].amount).toBe(50);
    expect(result.transactions[0].type).toBe('credit');
    expect(result.transactions[1].type).toBe('debit');
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

  it('rejects negative confidence', () => {
    expect(() => CategorizeResponseSchema.parse({
      results: [{ id: 't1', category: 'food', confidence: -0.1, source: 'ai' }],
    })).toThrow();
  });

  it('accepts confidence at exact boundaries 0 and 1', () => {
    const r0 = CategorizeResponseSchema.parse({
      results: [{ id: 't1', category: 'food', confidence: 0, source: 'rule' }],
    });
    expect(r0.results[0].confidence).toBe(0);

    const r1 = CategorizeResponseSchema.parse({
      results: [{ id: 't1', category: 'food', confidence: 1, source: 'keyword' }],
    });
    expect(r1.results[0].confidence).toBe(1);
  });

  it('rejects missing required fields in result', () => {
    expect(() => CategorizeResponseSchema.parse({
      results: [{ id: 't1' }],
    })).toThrow();
  });

  it('accepts all three source types', () => {
    for (const source of ['rule', 'ai', 'keyword'] as const) {
      const result = CategorizeResponseSchema.parse({
        results: [{ id: 't1', category: 'food', confidence: 0.5, source }],
      });
      expect(result.results[0].source).toBe(source);
    }
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

  it('applies defaults to nested optional objects', () => {
    const result = TransactionAnalyticsSchema.parse({
      currentMonth: {},
      previousMonth: {},
      threeMonthAvg: {},
    });
    expect(result.currentMonth?.income).toBe(0);
    expect(result.currentMonth?.expenses).toBe(0);
    expect(result.previousMonth?.income).toBe(0);
    expect(result.threeMonthAvg?.expenses).toBe(0);
  });

  it('validates byCategory with totals and counts', () => {
    const result = TransactionAnalyticsSchema.parse({
      byCategory: {
        groceries: { total: 5000, count: 10 },
        dining: { total: 2000, count: 5 },
      },
    });
    expect(result.byCategory?.groceries.total).toBe(5000);
    expect(result.byCategory?.dining.count).toBe(5);
  });

  it('defaults byCategory entry count to 0', () => {
    const result = TransactionAnalyticsSchema.parse({
      byCategory: { misc: { total: 100 } },
    });
    expect(result.byCategory?.misc.count).toBe(0);
  });

  it('validates topCategories array', () => {
    const result = TransactionAnalyticsSchema.parse({
      topCategories: [
        { category: 'groceries', total: 5000, percentage: 0.4 },
        { category: 'rent', total: 3000, percentage: 0.24 },
      ],
    });
    expect(result.topCategories).toHaveLength(2);
  });

  it('validates topMerchants array', () => {
    const result = TransactionAnalyticsSchema.parse({
      topMerchants: [
        { name: 'BigBasket', total: 3000, count: 8 },
      ],
    });
    expect(result.topMerchants?.[0].name).toBe('BigBasket');
  });

  it('validates byDayOfWeek record', () => {
    const result = TransactionAnalyticsSchema.parse({
      byDayOfWeek: {
        Monday: { total: 1000, count: 5 },
        Friday: { total: 2000 },
      },
    });
    expect(result.byDayOfWeek?.Monday.count).toBe(5);
    expect(result.byDayOfWeek?.Friday.total).toBe(2000);
    expect(result.byDayOfWeek?.Friday.count).toBe(0); // defaulted
  });

  it('validates byMonth record', () => {
    const result = TransactionAnalyticsSchema.parse({
      byMonth: {
        '2024-01': { income: 50000, expenses: 30000 },
      },
    });
    expect(result.byMonth?.['2024-01'].income).toBe(50000);
  });

  it('validates byCategoryByMonth record', () => {
    const result = TransactionAnalyticsSchema.parse({
      byCategoryByMonth: {
        groceries: { '2024-01': 5000, '2024-02': 4500 },
      },
    });
    expect(result.byCategoryByMonth?.groceries['2024-01']).toBe(5000);
  });

  it('validates anomalies array', () => {
    const result = TransactionAnalyticsSchema.parse({
      anomalies: [
        { description: 'Unusual charge', amount: 9999, zScore: 3.2 },
        { description: 'Double billing', amount: 500 },
      ],
    });
    expect(result.anomalies).toHaveLength(2);
    expect(result.anomalies?.[0].zScore).toBe(3.2);
    expect(result.anomalies?.[1].zScore).toBeUndefined();
  });

  it('parses empty object with all defaults', () => {
    const result = TransactionAnalyticsSchema.parse({});
    expect(result.totalTransactions).toBe(0);
    expect(result.dateRange).toBeUndefined();
    expect(result.byCategory).toBeUndefined();
    expect(result.anomalies).toBeUndefined();
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

  it('accepts 2-character currency code', () => {
    expect(() => InsightsRequestSchema.parse({
      analytics: {},
      currency: { code: 'US', symbol: '$', name: 'Dollar' },
    })).toThrow();
  });

  it('defaults baseUrl to DEFAULT_URLS.ollama', () => {
    const result = InsightsRequestSchema.parse({
      analytics: {},
      currency,
    });
    expect(result.baseUrl).toContain('localhost');
  });

  it('accepts lmstudio provider', () => {
    const result = InsightsRequestSchema.parse({
      analytics: {},
      currency,
      provider: 'lmstudio',
    });
    expect(result.provider).toBe('lmstudio');
  });

  it('accepts optional model', () => {
    const result = InsightsRequestSchema.parse({
      analytics: {},
      currency,
      model: 'mistral',
    });
    expect(result.model).toBe('mistral');
  });

  it('rejects invalid baseUrl', () => {
    expect(() => InsightsRequestSchema.parse({
      analytics: {},
      currency,
      baseUrl: 'not-a-url',
    })).toThrow();
  });

  it('passes through full analytics object', () => {
    const result = InsightsRequestSchema.parse({
      analytics: {
        totalTransactions: 100,
        currentMonth: { income: 50000, expenses: 30000 },
        topCategories: [{ category: 'food', total: 1000, percentage: 0.3 }],
      },
      currency,
    });
    expect(result.analytics.totalTransactions).toBe(100);
    expect(result.analytics.topCategories).toHaveLength(1);
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

  it('accepts all 7 insight types', () => {
    const types = [
      'category_trend', 'day_pattern', 'merchant_insight', 'anomaly',
      'budget_alert', 'period_comparison', 'savings_opportunity',
    ] as const;
    for (const type of types) {
      const result = InsightSchema.parse({
        type,
        title: 'Test',
        description: 'Desc',
        severity: 'info',
      });
      expect(result.type).toBe(type);
    }
  });

  it('rejects description over 500 chars', () => {
    expect(() => InsightSchema.parse({
      type: 'anomaly',
      title: 't',
      description: 'x'.repeat(501),
      severity: 'info',
    })).toThrow();
  });

  it('accepts description at exactly 500 chars', () => {
    const result = InsightSchema.parse({
      type: 'anomaly',
      title: 't',
      description: 'x'.repeat(500),
      severity: 'info',
    });
    expect(result.description).toHaveLength(500);
  });

  it('accepts all 3 severity levels', () => {
    for (const severity of ['info', 'warning', 'positive'] as const) {
      const result = InsightSchema.parse({
        type: 'anomaly',
        title: 't',
        description: 'd',
        severity,
      });
      expect(result.severity).toBe(severity);
    }
  });

  it('accepts optional category', () => {
    const result = InsightSchema.parse({
      type: 'category_trend',
      title: 't',
      description: 'd',
      severity: 'info',
      category: 'groceries',
    });
    expect(result.category).toBe('groceries');
  });

  it('accepts optional data record', () => {
    const result = InsightSchema.parse({
      type: 'anomaly',
      title: 't',
      description: 'd',
      severity: 'warning',
      data: { zScore: 3.2, mean: 100 },
    });
    expect(result.data?.zScore).toBe(3.2);
  });

  it('rejects missing required fields', () => {
    expect(() => InsightSchema.parse({ title: 't', description: 'd', severity: 'info' })).toThrow();
    expect(() => InsightSchema.parse({ type: 'anomaly', description: 'd', severity: 'info' })).toThrow();
    expect(() => InsightSchema.parse({ type: 'anomaly', title: 't', severity: 'info' })).toThrow();
    expect(() => InsightSchema.parse({ type: 'anomaly', title: 't', description: 'd' })).toThrow();
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
