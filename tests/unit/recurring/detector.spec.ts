import { describe, it, expect } from 'vitest';
import {
  normalizeMerchantName,
  merchantsMatch,
  calculateIntervals,
  detectFrequency,
  calculateConfidence,
  isActivePayment,
  detectRecurringPayments,
  getMonthlyAmount,
  getTotalMonthlyRecurring,
  groupTransactionsByMerchant,
} from '@/lib/recurring/detector';
import { TransactionType } from '@/types';
import type { RecurringPayment, DetectionConfig } from '@/lib/recurring/types';
import { makeTransaction, makeCategory } from '@tests/unit/factories';

describe('normalizeMerchantName', () => {
  it('lowercases', () => {
    expect(normalizeMerchantName('NETFLIX')).toBe('netflix');
  });

  it('removes subscription suffix', () => {
    expect(normalizeMerchantName('NETFLIX SUBSCRIPTION')).toBe('netflix');
  });

  it('removes pvt ltd suffix', () => {
    expect(normalizeMerchantName('AMAZON INDIA PVT LTD')).toBe('amazon india');
  });

  it('removes special chars', () => {
    expect(normalizeMerchantName('STARBUCKS™')).toBe('starbucks');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeMerchantName('')).toBe('');
  });

  it('removes payment prefixes', () => {
    expect(normalizeMerchantName('Payment to Netflix')).toBe('netflix');
  });
});

describe('merchantsMatch', () => {
  it('exact match', () => {
    expect(merchantsMatch('netflix', 'netflix')).toBe(true);
  });

  it('substring match', () => {
    expect(merchantsMatch('netflix subscription', 'netflix')).toBe(true);
  });

  it('first word match', () => {
    expect(merchantsMatch('amazon in', 'amazon')).toBe(true);
  });

  it('no match', () => {
    expect(merchantsMatch('netflix', 'spotify')).toBe(false);
  });
});

describe('calculateIntervals', () => {
  it('calculates days between sorted dates', () => {
    const dates = [
      new Date(2024, 0, 1),
      new Date(2024, 1, 1),
      new Date(2024, 2, 1),
      new Date(2024, 3, 1),
    ];
    const intervals = calculateIntervals(dates);
    expect(intervals).toEqual([31, 29, 31]); // Jan->Feb (leap year), Feb->Mar, Mar->Apr
  });

  it('returns empty for fewer than 2 dates', () => {
    expect(calculateIntervals([new Date(2024, 0, 1)])).toEqual([]);
  });
});

describe('detectFrequency', () => {
  it('detects monthly (~30 days ±7)', () => {
    const intervals = [31, 30, 31, 30, 31];
    const config = { intervalTolerance: 7 } as DetectionConfig;
    const result = detectFrequency(intervals, config);
    expect(result.frequency).toBe('monthly');
    expect(result.intervalVariance).toBeLessThan(0.05);
  });

  it('detects weekly (~7 days)', () => {
    const intervals = [7, 7, 7, 7];
    const config = { intervalTolerance: 2 } as DetectionConfig;
    const result = detectFrequency(intervals, config);
    expect(result.frequency).toBe('weekly');
  });

  it('detects quarterly (~91 days)', () => {
    const intervals = [91, 90, 91];
    const config = { intervalTolerance: 14 } as DetectionConfig;
    const result = detectFrequency(intervals, config);
    expect(result.frequency).toBe('quarterly');
  });

  it('detects yearly (~365 days)', () => {
    const intervals = [365, 365];
    const config = { intervalTolerance: 30 } as DetectionConfig;
    const result = detectFrequency(intervals, config);
    expect(result.frequency).toBe('yearly');
  });

  it('returns null for irregular intervals', () => {
    const intervals = [3, 45, 12, 89];
    const config = { intervalTolerance: 7 } as DetectionConfig;
    const result = detectFrequency(intervals, config);
    expect(result.frequency).toBeNull();
  });

  it('returns null for empty intervals', () => {
    const config = { intervalTolerance: 7 } as DetectionConfig;
    const result = detectFrequency([], config);
    expect(result.frequency).toBeNull();
  });
});

describe('calculateConfidence', () => {
  it('high confidence for consistent payments', () => {
    const txns = Array.from({ length: 6 }, (_, i) =>
      makeTransaction({ id: `t${i}`, amount: 649, date: new Date(2024, i, 1) })
    );
    const result = calculateConfidence(txns, 'monthly', [31, 31, 30, 31, 30], {
      minOccurrences: 2,
      amountVariance: 0.10,
    } as DetectionConfig);
    expect(result.score).toBeGreaterThanOrEqual(0.9);
  });

  it('low confidence for variable amounts with excludeVariableAmounts', () => {
    const txns = [
      makeTransaction({ id: '1', amount: 100, date: new Date(2024, 0, 1) }),
      makeTransaction({ id: '2', amount: 200, date: new Date(2024, 1, 1) }),
      makeTransaction({ id: '3', amount: 300, date: new Date(2024, 2, 1) }),
      makeTransaction({ id: '4', amount: 400, date: new Date(2024, 3, 1) }),
      makeTransaction({ id: '5', amount: 500, date: new Date(2024, 4, 1) }),
      makeTransaction({ id: '6', amount: 600, date: new Date(2024, 5, 1) }),
    ];
    const result = calculateConfidence(txns, 'monthly', [31, 28, 31, 30, 31], {
      minOccurrences: 2,
      amountVariance: 0.10,
      excludeVariableAmounts: true,
    } as DetectionConfig);
    expect(result.score).toBe(0);
  });

  it('zero confidence when excludeVariableAmounts is true and amounts vary', () => {
    const txns = [
      makeTransaction({ id: '1', amount: 100, date: new Date(2024, 0, 1) }),
      makeTransaction({ id: '2', amount: 200, date: new Date(2024, 1, 1) }),
      makeTransaction({ id: '3', amount: 300, date: new Date(2024, 2, 1) }),
      makeTransaction({ id: '4', amount: 400, date: new Date(2024, 3, 1) }),
      makeTransaction({ id: '5', amount: 500, date: new Date(2024, 4, 1) }),
      makeTransaction({ id: '6', amount: 600, date: new Date(2024, 5, 1) }),
    ];
    const result = calculateConfidence(txns, 'monthly', [31, 28, 31, 30, 31], {
      minOccurrences: 2,
      amountVariance: 0.10,
      excludeVariableAmounts: true,
    } as DetectionConfig);
    expect(result.score).toBe(0);
  });
});

describe('isActivePayment', () => {
  it('active if within grace period', () => {
    const lastSeen = new Date(Date.now() - 25 * 24 * 60 * 60 * 1000); // 25 days ago
    expect(isActivePayment(lastSeen, 'monthly', { inactiveAfterMissed: 1 } as DetectionConfig)).toBe(true);
  });

  it('inactive if past grace period', () => {
    const lastSeen = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 days ago
    expect(isActivePayment(lastSeen, 'monthly', { inactiveAfterMissed: 1 } as DetectionConfig)).toBe(false);
  });
});

describe('groupTransactionsByMerchant', () => {
  it('groups transactions by normalized merchant name', () => {
    const txns = [
      makeTransaction({ id: '1', description: 'NETFLIX.COM' }),
      makeTransaction({ id: '2', description: 'NETFLIX SUBSCRIPTION' }),
      makeTransaction({ id: '3', description: 'SPOTIFY' }),
    ];
    const groups = groupTransactionsByMerchant(txns);
    expect(groups).toHaveLength(2);
    const netflixGroup = groups.find(g => g.normalizedName.includes('netflix'));
    expect(netflixGroup?.transactions).toHaveLength(2);
  });
});

describe('detectRecurringPayments', () => {
  it('detects Netflix subscription (6 monthly payments)', () => {
    const txns = Array.from({ length: 6 }, (_, i) =>
      makeTransaction({
        id: `netflix${i}`,
        description: 'NETFLIX SUBSCRIPTION',
        amount: 649,
        type: TransactionType.Debit,
        date: new Date(2024, i, 1),
        category: makeCategory('entertainment'),
      })
    );
    const result = detectRecurringPayments(txns);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].merchantName.toLowerCase()).toContain('netflix');
    expect(result[0].frequency).toBe('monthly');
    expect(result[0].confidence).toBeGreaterThanOrEqual(0.7);
  });
});

describe('getMonthlyAmount', () => {
  it('converts weekly to monthly', () => {
    expect(getMonthlyAmount(100, 'weekly')).toBeCloseTo(433, 0);
  });

  it('converts quarterly to monthly', () => {
    expect(getMonthlyAmount(300, 'quarterly')).toBe(100);
  });

  it('converts yearly to monthly', () => {
    expect(getMonthlyAmount(1200, 'yearly')).toBe(100);
  });

  it('keeps monthly as-is', () => {
    expect(getMonthlyAmount(500, 'monthly')).toBe(500);
  });
});

describe('getTotalMonthlyRecurring', () => {
  it('sums active payments', () => {
    const payments: RecurringPayment[] = [
      { id: '1', amount: 649, frequency: 'monthly', isActive: true } as RecurringPayment,
      { id: '2', amount: 149, frequency: 'monthly', isActive: true } as RecurringPayment,
    ];
    expect(getTotalMonthlyRecurring(payments)).toBe(798);
  });

  it('excludes inactive payments', () => {
    const payments: RecurringPayment[] = [
      { id: '1', amount: 649, frequency: 'monthly', isActive: true } as RecurringPayment,
      { id: '2', amount: 149, frequency: 'monthly', isActive: false } as RecurringPayment,
    ];
    expect(getTotalMonthlyRecurring(payments)).toBe(649);
  });
});
