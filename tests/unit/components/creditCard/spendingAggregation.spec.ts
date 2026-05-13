import { describe, it, expect } from 'vitest';
import {
  filterCCSpendTransactions,
  aggregateByCategory,
  aggregateByCard,
  extractMerchantName,
  aggregateByMerchant,
  computeMonthlyTrend,
  computeTotalSpend,
  COLORS,
  type TransactionLike,
} from '@/components/creditCard/spendingAggregation';

function txn(overrides: Partial<TransactionLike> & { date: Date | string }): TransactionLike {
  return {
    sourceType: 'credit_card',
    isDebit: true,
    amount: 100,
    description: 'AMAZON RETAIL PVT LTD',
    cardIssuer: 'HDFC',
    cardLastFour: '1234',
    category: { id: 'shopping' },
    ...overrides,
  };
}

const mockCategoryDisplay = (catId: string) => ({
  name: catId === 'shopping' ? 'Shopping' : catId === 'dining' ? 'Dining' : catId,
  color: '#3b82f6',
});

describe('filterCCSpendTransactions', () => {
  it('keeps only CC debit transactions', () => {
    const txns = [
      txn({ date: '2025-01-15', sourceType: 'credit_card', isDebit: true, amount: 100 }),
      txn({ date: '2025-01-15', sourceType: 'credit_card', isDebit: false, amount: 50 }),
      txn({ date: '2025-01-15', sourceType: 'bank', isDebit: true, amount: 200 }),
    ];

    const result = filterCCSpendTransactions(txns);
    expect(result).toHaveLength(1);
    expect(result[0].amount).toBe(100);
  });

  it('returns empty for no CC transactions', () => {
    const txns = [
      txn({ date: '2025-01-15', sourceType: 'bank', isDebit: true, amount: 100 }),
    ];

    expect(filterCCSpendTransactions(txns)).toHaveLength(0);
  });
});

describe('aggregateByCategory', () => {
  it('groups by category and computes percentages', () => {
    const txns = [
      txn({ date: '2025-01-15', category: { id: 'shopping' }, amount: 300 }),
      txn({ date: '2025-01-15', category: { id: 'shopping' }, amount: 200 }),
      txn({ date: '2025-01-15', category: { id: 'dining' }, amount: 500 }),
    ];

    const result = aggregateByCategory(txns, mockCategoryDisplay);
    expect(result).toHaveLength(2);
    // Both sum to 500, so order depends on insertion
    const ids = result.map((r) => r.id);
    expect(ids).toContain('dining');
    expect(ids).toContain('shopping');
    for (const r of result) {
      expect(r.value).toBe(500);
      expect(r.percentage).toBe(50);
    }
  });

  it('handles uncategorized transactions', () => {
    const txns = [
      txn({ date: '2025-01-15', category: null, amount: 100 }),
    ];

    const result = aggregateByCategory(txns, mockCategoryDisplay);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('uncategorized');
  });

  it('respects limit parameter', () => {
    const txns = Array.from({ length: 10 }, (_, i) =>
      txn({ date: '2025-01-15', category: { id: `cat-${i}` }, amount: 100 + i }),
    );

    const result = aggregateByCategory(txns, mockCategoryDisplay, 3);
    expect(result).toHaveLength(3);
  });

  it('returns 0 percentage when total is zero', () => {
    const result = aggregateByCategory([], mockCategoryDisplay);
    expect(result).toHaveLength(0);
  });
});

describe('aggregateByCard', () => {
  it('groups by card and computes percentages', () => {
    const txns = [
      txn({ date: '2025-01-15', cardIssuer: 'HDFC', cardLastFour: '1234', amount: 300 }),
      txn({ date: '2025-01-15', cardIssuer: 'HDFC', cardLastFour: '1234', amount: 200 }),
      txn({ date: '2025-01-15', cardIssuer: 'SBI', cardLastFour: '5678', amount: 500 }),
    ];

    const result = aggregateByCard(txns);
    expect(result).toHaveLength(2);
    const keys = result.map((r) => r.key);
    expect(keys).toContain('SBI-5678');
    expect(keys).toContain('HDFC-1234');
    // Both sum to 500
    for (const r of result) {
      expect(r.percentage).toBe(50);
    }
  });

  it('skips transactions without card info', () => {
    const txns = [
      txn({ date: '2025-01-15', cardIssuer: undefined, cardLastFour: undefined, amount: 100 }),
      txn({ date: '2025-01-15', cardIssuer: 'HDFC', cardLastFour: '1234', amount: 200 }),
    ];

    const result = aggregateByCard(txns);
    expect(result).toHaveLength(1);
  });

  it('formats label as first word of issuer plus lastFour', () => {
    const txns = [
      txn({ date: '2025-01-15', cardIssuer: 'HDFC Bank Premium', cardLastFour: '9999', amount: 100 }),
    ];

    const result = aggregateByCard(txns);
    expect(result[0].label).toBe('HDFC ****9999');
  });
});

describe('extractMerchantName', () => {
  it('takes first two words up to 20 chars', () => {
    expect(extractMerchantName('AMAZON RETAIL PVT LTD')).toBe('AMAZON RETAIL');
  });

  it('handles single word', () => {
    expect(extractMerchantName('NETFLIX')).toBe('NETFLIX');
  });

  it('truncates at 20 chars', () => {
    expect(extractMerchantName('VERYLONGMERCHANTNAME EXCEEDING LIMIT')).toBe('VERYLONGMERCHANTNAME');
  });

  it('returns Unknown for empty/undefined', () => {
    expect(extractMerchantName(undefined)).toBe('Unknown');
    expect(extractMerchantName('')).toBe('Unknown');
    expect(extractMerchantName('   ')).toBe('Unknown');
  });
});

describe('aggregateByMerchant', () => {
  it('groups by merchant name and sums amounts', () => {
    const txns = [
      txn({ date: '2025-01-15', description: 'AMAZON RETAIL', amount: 300 }),
      txn({ date: '2025-01-15', description: 'AMAZON RETAIL', amount: 200 }),
      txn({ date: '2025-01-15', description: 'FLIPKART PVT', amount: 500 }),
    ];

    const result = aggregateByMerchant(txns);
    expect(result).toHaveLength(2);
    const names = result.map((r) => r.name);
    expect(names).toContain('FLIPKART PVT');
    expect(names).toContain('AMAZON RETAIL');
    // Both sum to 500
    for (const r of result) {
      expect(r.amount).toBe(500);
    }
    // AMAZON has 2 transactions
    const amazon = result.find((r) => r.name === 'AMAZON RETAIL')!;
    expect(amazon.count).toBe(2);
  });

  it('respects limit parameter', () => {
    const txns = Array.from({ length: 10 }, (_, i) =>
      txn({ date: '2025-01-15', description: `MERCHANT ${i}`, amount: 100 + i }),
    );

    const result = aggregateByMerchant(txns, 3);
    expect(result).toHaveLength(3);
  });
});

describe('computeMonthlyTrend', () => {
  it('initializes last 6 months with zeros', () => {
    const now = new Date(2025, 5, 15); // Jun 2025
    const result = computeMonthlyTrend([], 6, now);

    expect(result).toHaveLength(6);
    expect(result[0].amount).toBe(0);
    expect(result[5].amount).toBe(0);
  });

  it('aggregates transactions into correct months', () => {
    const now = new Date(2025, 5, 15);
    const txns = [
      txn({ date: new Date(2025, 4, 10), amount: 100 }), // May
      txn({ date: new Date(2025, 4, 20), amount: 200 }), // May
      txn({ date: new Date(2025, 3, 10), amount: 300 }), // Apr
    ];

    const result = computeMonthlyTrend(txns, 6, now);
    expect(result[4].amount).toBe(300); // May (index 4 in Jan-Jun)
    expect(result[3].amount).toBe(300); // Apr
  });

  it('ignores transactions outside the window', () => {
    const now = new Date(2025, 5, 15);
    const txns = [
      txn({ date: new Date(2024, 0, 10), amount: 9999 }), // Jan 2024, way outside
    ];

    const result = computeMonthlyTrend(txns, 6, now);
    expect(result.every((m) => m.amount === 0)).toBe(true);
  });

  it('uses string dates correctly', () => {
    const now = new Date(2025, 5, 15);
    const txns = [
      txn({ date: '2025-05-10', amount: 500 }),
    ];

    const result = computeMonthlyTrend(txns, 6, now);
    expect(result.some((m) => m.amount === 500)).toBe(true);
  });
});

describe('computeTotalSpend', () => {
  it('sums absolute amounts', () => {
    const txns = [
      txn({ date: '2025-01-15', amount: 300 }),
      txn({ date: '2025-01-15', amount: -200 }),
    ];

    expect(computeTotalSpend(txns)).toBe(500);
  });

  it('returns 0 for empty array', () => {
    expect(computeTotalSpend([])).toBe(0);
  });
});

describe('COLORS', () => {
  it('has 6 entries', () => {
    expect(COLORS).toHaveLength(6);
  });

  it('contains oklch values', () => {
    for (const c of COLORS) {
      expect(c).toMatch(/^oklch\(/);
    }
  });
});
