import { describe, it, expect } from 'vitest';
import {
  calculateCategoryStats,
  detectAmountAnomaly,
  detectDuplicate,
  detectFrequencyAnomaly,
  detectAnomalies,
  extractMerchant,
  stringSimilarity,
} from '@/lib/anomaly/detector';
import { TransactionType, CategoryType } from '@/types';
import { makeTransaction, makeCategory } from '@tests/unit/factories';

describe('extractMerchant', () => {
  it('extracts first 3 words lowercase', () => {
    expect(extractMerchant('THE AMAZON PURCHASE')).toBe('the amazon purchase');
  });

  it('removes leading codes like AMZN *', () => {
    expect(extractMerchant('AMZN * AMAZON')).toBe('amazon');
  });

  it('removes leading numbers', () => {
    expect(extractMerchant('12345 AMAZON')).toBe('amazon');
  });
});

describe('stringSimilarity', () => {
  it('returns 1 for identical strings', () => {
    expect(stringSimilarity('amazon', 'amazon')).toBe(1);
  });

  it('returns 0 for empty strings', () => {
    expect(stringSimilarity('', 'amazon')).toBe(0);
  });

  it('returns high similarity for similar strings', () => {
    expect(stringSimilarity('amazon india', 'amazon.india')).toBeGreaterThan(0.8);
  });

  it('returns low similarity for different strings', () => {
    expect(stringSimilarity('amazon', 'netflix')).toBeLessThan(0.5);
  });
});

describe('calculateCategoryStats', () => {
  it('calculates mean and stdDev for categories with 5+ transactions', () => {
    const txns = [
      makeTransaction({ id: '1', amount: 100, category: makeCategory('dining') }),
      makeTransaction({ id: '2', amount: 200, category: makeCategory('dining') }),
      makeTransaction({ id: '3', amount: 300, category: makeCategory('dining') }),
      makeTransaction({ id: '4', amount: 400, category: makeCategory('dining') }),
      makeTransaction({ id: '5', amount: 500, category: makeCategory('dining') }),
    ];
    const stats = calculateCategoryStats(txns);
    expect(stats.dining).toBeDefined();
    expect(stats.dining.count).toBe(5);
    expect(stats.dining.mean).toBe(300);
    expect(stats.dining.stdDev).toBeGreaterThan(0);
  });

  it('skips categories with fewer than 5 transactions', () => {
    const txns = [
      makeTransaction({ id: '1', amount: 100, category: makeCategory('dining') }),
      makeTransaction({ id: '2', amount: 200, category: makeCategory('dining') }),
      makeTransaction({ id: '3', amount: 300, category: makeCategory('dining') }),
    ];
    const stats = calculateCategoryStats(txns);
    expect(stats.dining).toBeUndefined();
  });

  it('skips categories with zero stdDev', () => {
    const txns = Array.from({ length: 5 }, (_, i) =>
      makeTransaction({ id: `${i}`, amount: 100, category: makeCategory('dining') })
    );
    const stats = calculateCategoryStats(txns);
    expect(stats.dining).toBeUndefined();
  });

  it('excludes non-expense transactions', () => {
    const txns = Array.from({ length: 5 }, (_, i) =>
      makeTransaction({ id: `${i}`, amount: 5000, type: TransactionType.Credit, category: makeCategory('income', CategoryType.Income) })
    );
    const stats = calculateCategoryStats(txns);
    expect(Object.keys(stats)).toHaveLength(0);
  });
});

describe('detectAmountAnomaly', () => {
  it('flags high z-score transaction', () => {
    const stats = { dining: { count: 10, mean: 500, stdDev: 100 } };
    const txn = makeTransaction({ amount: 5000, category: makeCategory('dining') });
    const result = detectAmountAnomaly(txn, stats);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('high_amount');
  });

  it('does not flag normal amount', () => {
    const stats = { dining: { count: 10, mean: 500, stdDev: 200 } };
    const txn = makeTransaction({ amount: 550, category: makeCategory('dining') });
    expect(detectAmountAnomaly(txn, stats)).toBeNull();
  });

  it('flags low z-score transaction', () => {
    const stats = { dining: { count: 10, mean: 500, stdDev: 100 } };
    const txn = makeTransaction({ amount: 200, category: makeCategory('dining') }); // z = (200-500)/100 = -3.0
    const result = detectAmountAnomaly(txn, stats);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('low_amount');
  });

  it('returns null for unknown category', () => {
    const stats = { dining: { count: 10, mean: 500, stdDev: 200 } };
    const txn = makeTransaction({ amount: 5000, category: makeCategory('unknown') });
    expect(detectAmountAnomaly(txn, stats)).toBeNull();
  });

  it('returns null for non-expense transactions', () => {
    const stats = { income: { count: 10, mean: 5000, stdDev: 2000 } };
    const txn = makeTransaction({ amount: 50000, type: TransactionType.Credit, category: makeCategory('income', CategoryType.Income) });
    expect(detectAmountAnomaly(txn, stats)).toBeNull();
  });
});

describe('detectDuplicate', () => {
  it('detects exact duplicate (same amount, similar merchant, within 48h)', () => {
    const txn = makeTransaction({ id: '1', description: 'THE AMAZON PURCHASE', amount: 1299, date: new Date('2024-01-15') });
    const allTxns = [
      txn,
      makeTransaction({ id: '2', description: 'THE AMAZON PURCHASE', amount: 1299, date: new Date('2024-01-15T10:00:00') }),
    ];
    const result = detectDuplicate(txn, allTxns);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('duplicate');
  });

  it('does not flag different amounts', () => {
    const txn = makeTransaction({ id: '1', description: 'AMAZON', amount: 1299, date: new Date('2024-01-15') });
    const allTxns = [makeTransaction({ id: '2', description: 'AMAZON', amount: 2000, date: new Date('2024-01-15') })];
    expect(detectDuplicate(txn, allTxns)).toBeNull();
  });

  it('does not flag outside 48h window', () => {
    const txn = makeTransaction({ id: '1', description: 'AMAZON', amount: 1299, date: new Date('2024-01-15') });
    const allTxns = [makeTransaction({ id: '2', description: 'AMAZON', amount: 1299, date: new Date('2024-01-18') })];
    expect(detectDuplicate(txn, allTxns)).toBeNull();
  });

  it('detects near-duplicate with similar merchant name', () => {
    const txn = makeTransaction({ id: '1', description: 'THE AMAZON PURCHASE', amount: 1299, date: new Date('2024-01-15') });
    const allTxns = [makeTransaction({ id: '2', description: 'THE AMAZON.PURCHASE', amount: 1299, date: new Date('2024-01-15T12:00:00') })];
    const result = detectDuplicate(txn, allTxns);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('duplicate');
  });
});

describe('detectFrequencyAnomaly', () => {
  it('flags 3+ same merchant in 24h', () => {
    const txn = makeTransaction({ id: '1', description: 'THE SWIGGY FOOD', amount: 350, date: new Date('2024-01-15T20:00:00') });
    const allTxns = [
      makeTransaction({ id: '2', description: 'THE SWIGGY FOOD', amount: 300, date: new Date('2024-01-15T10:00:00') }),
      makeTransaction({ id: '3', description: 'THE SWIGGY FOOD', amount: 400, date: new Date('2024-01-15T14:00:00') }),
    ];
    const result = detectFrequencyAnomaly(txn, allTxns);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('unusual_frequency');
  });

  it('flags 5+ same merchant in 7d', () => {
    const txn = makeTransaction({ id: '1', description: 'THE AMAZON PURCHASE', amount: 500, date: new Date('2024-01-20') });
    const allTxns = Array.from({ length: 5 }, (_, i) =>
      makeTransaction({ id: `t${i}`, description: 'THE AMAZON PURCHASE', amount: 400 + i * 100, date: new Date(2024, 0, 15 + i) })
    );
    const result = detectFrequencyAnomaly(txn, allTxns);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('unusual_frequency');
  });

  it('does not flag normal frequency', () => {
    const txn = makeTransaction({ id: '1', description: 'AMAZON', amount: 500, date: new Date('2024-01-20') });
    const allTxns = [makeTransaction({ id: '2', description: 'AMAZON', amount: 400, date: new Date('2024-01-10') })];
    expect(detectFrequencyAnomaly(txn, allTxns)).toBeNull();
  });
});

describe('detectAnomalies (full pipeline)', () => {
  it('flags amount anomalies', () => {
    const normalTxns = Array.from({ length: 10 }, (_, i) =>
      makeTransaction({ id: `n${i}`, description: 'THE SWIGGY FOOD ORDER', amount: 300 + i * 20 })
    );
    const outlier = makeTransaction({ id: 'outlier', description: 'EXPENSIVE RESTAURANT BILL', amount: 50000 });
    const allTxns = [...normalTxns, outlier];
    const result = detectAnomalies(allTxns);
    const flagged = result.find(t => t.id === 'outlier');
    expect(flagged?.isAnomaly).toBe(true);
  });

  it('clears anomaly flags when none found', () => {
    // Each transaction has a unique merchant to avoid frequency anomalies
    const txns = Array.from({ length: 5 }, (_, i) =>
      makeTransaction({ id: `t${i}`, description: `MERCHANT ${i} PURCHASE`, amount: 100 + i * 10 })
    );
    const result = detectAnomalies(txns);
    expect(result.every(t => !t.isAnomaly)).toBe(true);
  });

  it('preserves dismissed flag on re-scan', () => {
    const normalTxns = Array.from({ length: 10 }, (_, i) =>
      makeTransaction({ id: `n${i}`, description: 'THE SWIGGY FOOD ORDER', amount: 300 + i * 20 })
    );
    // Create a dismissed anomaly transaction using the factory
    const dismissed = makeTransaction({
      id: '1',
      description: 'EXPENSIVE RESTAURANT',
      amount: 50000,
      category: makeCategory('dining'),
      isAnomaly: true,
      anomalyDismissed: true,
    });
    const txns = [dismissed, ...normalTxns];
    const result = detectAnomalies(txns);
    const flagged = result.find(t => t.id === '1');
    expect(flagged?.anomalyDismissed).toBe(true);
  });
});
