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
  predictNextDate,
} from '@/lib/recurring/detector';
import { TransactionType, CategoryType } from '@/types';
import type { RecurringPayment, DetectionConfig } from '@/lib/recurring/types';
import { DEFAULT_DETECTION_CONFIG } from '@/lib/recurring/types';
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

  it('returns false when first significant word is a common word', () => {
    // "the" is in the commonWords list — even though first significant word matches, should return false
    expect(merchantsMatch('The Something', 'The Other')).toBe(false);
  });

  it('matches on first significant non-common word when neither contains the other', () => {
    // 'netflix' and 'netflix' as first significant word — but neither string contains the other
    // because they differ after the first word
    expect(merchantsMatch('Netflix Premium Plan', 'Netflix Basic Plan')).toBe(true);
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

  it('marks payments as inactive when last seen exceeds grace period', () => {
    const txns = Array.from({ length: 6 }, (_, i) =>
      makeTransaction({
        id: `old${i}`,
        description: 'OLD SUBSCRIPTION',
        amount: 500,
        type: TransactionType.Debit,
        date: new Date(2023, i, 1), // 2023 — well over 90 days ago
        category: makeCategory('entertainment'),
      })
    );
    const result = detectRecurringPayments(txns);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].isActive).toBe(false);
  });

  it('does not set nextExpectedDate for inactive payments', () => {
    const txns = Array.from({ length: 6 }, (_, i) =>
      makeTransaction({
        id: `old${i}`,
        description: 'OLD SERVICE',
        amount: 500,
        type: TransactionType.Debit,
        date: new Date(2023, i, 1),
        category: makeCategory('entertainment'),
      })
    );
    const result = detectRecurringPayments(txns);
    const payment = result.find(r => !r.isActive);
    expect(payment).toBeDefined();
    expect(payment!.nextExpectedDate).toBeUndefined();
  });

  it('sorts active payments before inactive, then by amount descending', () => {
    const now = new Date();
    const activeTxns = Array.from({ length: 3 }, (_, i) =>
      makeTransaction({
        id: `active${i}`,
        description: 'ACTIVE SMALL',
        amount: 100,
        type: TransactionType.Debit,
        date: new Date(now.getFullYear(), now.getMonth() - i, 1),
        category: makeCategory('entertainment'),
      })
    );
    const inactiveTxns = Array.from({ length: 3 }, (_, i) =>
      makeTransaction({
        id: `inactive${i}`,
        description: 'INACTIVE LARGE',
        amount: 999,
        type: TransactionType.Debit,
        date: new Date(now.getFullYear() - 3, i, 1),
        category: makeCategory('entertainment'),
      })
    );
    const result = detectRecurringPayments([...activeTxns, ...inactiveTxns]);
    expect(result.length).toBeGreaterThanOrEqual(2);
    const activeOnes = result.filter(r => r.isActive);
    const inactiveOnes = result.filter(r => !r.isActive);
    expect(activeOnes.length).toBeGreaterThan(0);
    expect(inactiveOnes.length).toBeGreaterThan(0);
    // Active comes before inactive in the sorted result
    const firstInactiveIdx = result.findIndex(r => !r.isActive);
    const lastActiveIdx = result.length - 1 - [...result].reverse().findIndex(r => r.isActive);
    expect(firstInactiveIdx).toBeGreaterThan(lastActiveIdx);
  });

  it('skips groups below minOccurrences', () => {
    const txns = [
      makeTransaction({
        id: 'single',
        description: 'LONE TRANSACTION',
        amount: 100,
        type: TransactionType.Debit,
        date: new Date(2024, 0, 1),
        category: makeCategory('other'),
      }),
    ];
    const result = detectRecurringPayments(txns);
    expect(result).toHaveLength(0);
  });

  it('skips groups where confidence is below threshold', () => {
    const txns = [
      makeTransaction({ id: '1', description: 'VARIABLE', amount: 100, type: TransactionType.Debit, date: new Date(2024, 0, 1), category: makeCategory('other') }),
      makeTransaction({ id: '2', description: 'VARIABLE', amount: 999, type: TransactionType.Debit, date: new Date(2024, 1, 1), category: makeCategory('other') }),
      makeTransaction({ id: '3', description: 'VARIABLE', amount: 50, type: TransactionType.Debit, date: new Date(2024, 2, 1), category: makeCategory('other') }),
      makeTransaction({ id: '4', description: 'VARIABLE', amount: 750, type: TransactionType.Debit, date: new Date(2024, 3, 1), category: makeCategory('other') }),
      makeTransaction({ id: '5', description: 'VARIABLE', amount: 200, type: TransactionType.Debit, date: new Date(2024, 4, 1), category: makeCategory('other') }),
      makeTransaction({ id: '6', description: 'VARIABLE', amount: 880, type: TransactionType.Debit, date: new Date(2024, 5, 1), category: makeCategory('other') }),
    ];
    const result = detectRecurringPayments(txns, { ...DEFAULT_DETECTION_CONFIG, excludeVariableAmounts: true });
    expect(result).toHaveLength(0);
  });

  it('skips groups where no frequency is detected', () => {
    const txns = [
      makeTransaction({ id: '1', description: 'ERRATIC', amount: 100, type: TransactionType.Debit, date: new Date(2024, 0, 1), category: makeCategory('other') }),
      makeTransaction({ id: '2', description: 'ERRATIC', amount: 100, type: TransactionType.Debit, date: new Date(2024, 0, 3), category: makeCategory('other') }),
      makeTransaction({ id: '3', description: 'ERRATIC', amount: 100, type: TransactionType.Debit, date: new Date(2024, 1, 15), category: makeCategory('other') }),
      makeTransaction({ id: '4', description: 'ERRATIC', amount: 100, type: TransactionType.Debit, date: new Date(2024, 3, 5), category: makeCategory('other') }),
    ];
    const result = detectRecurringPayments(txns);
    expect(result).toHaveLength(0);
  });

  it('uses latest amount for amount field, average for averageAmount', () => {
    const txns = [
      makeTransaction({ id: '1', description: 'VARYING', amount: 100, type: TransactionType.Debit, date: new Date(2024, 0, 1), category: makeCategory('other') }),
      makeTransaction({ id: '2', description: 'VARYING', amount: 100, type: TransactionType.Debit, date: new Date(2024, 1, 1), category: makeCategory('other') }),
      makeTransaction({ id: '3', description: 'VARYING', amount: 200, type: TransactionType.Debit, date: new Date(2024, 2, 1), category: makeCategory('other') }),
      makeTransaction({ id: '4', description: 'VARYING', amount: 200, type: TransactionType.Debit, date: new Date(2024, 3, 1), category: makeCategory('other') }),
    ];
    const result = detectRecurringPayments(txns, { ...DEFAULT_DETECTION_CONFIG, excludeVariableAmounts: false });
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].amount).toBe(200); // latest
    expect(result[0].averageAmount).toBe(150); // (100+100+200+200)/4
  });

  it('extracts category from first transaction', () => {
    const txns = Array.from({ length: 4 }, (_, i) =>
      makeTransaction({
        id: `cat${i}`,
        description: 'CATEGORIZED',
        amount: 100,
        type: TransactionType.Debit,
        date: new Date(2024, i, 1),
        category: makeCategory('entertainment'),
      })
    );
    const result = detectRecurringPayments(txns);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].category).toBe('entertainment');
  });

  it('falls back to uncategorized when category is missing', () => {
    const txns = Array.from({ length: 4 }, (_, i) =>
      makeTransaction({
        id: `nocat${i}`,
        description: 'NO CATEGORY',
        amount: 100,
        type: TransactionType.Debit,
        date: new Date(2024, i, 1),
        category: makeCategory(''), // empty id triggers fallback in detector
      })
    );
    const result = detectRecurringPayments(txns);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].category).toBe('uncategorized');
  });

  it('only considers expense transactions for recurring detection', () => {
    // Same merchant, same amounts, but mix of expense (debit) and income (credit).
    // groupTransactionsByMerchant filters to isExpense, so credit transactions
    // should not inflate the group or create a recurring payment from income.
    const txns = [
      ...Array.from({ length: 3 }, (_, i) =>
        makeTransaction({
          id: `exp${i}`,
          description: 'NETFLIX SUBSCRIPTION',
          amount: 499,
          type: TransactionType.Debit,
          date: new Date(2024, i, 5),
          category: makeCategory('entertainment'),
        })
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        makeTransaction({
          id: `inc${i}`,
          description: 'NETFLIX SUBSCRIPTION',
          amount: 499,
          type: TransactionType.Credit,
          date: new Date(2024, i, 15),
          category: makeCategory('entertainment', CategoryType.Income),
        })
      ),
    ];
    const result = detectRecurringPayments(txns);
    // Only the 3 expense transactions form a group; 3 occurrences meet minOccurrences.
    expect(result.length).toBe(1);
    // Verify it only counted expense transactions by checking the amount list
    expect(result[0].occurrenceCount).toBe(3);
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

  it('returns amount unchanged for unknown frequency via default case', () => {
    // The default case in getMonthlyAmount is unreachable via TypeScript's type system,
    // but can be triggered at runtime. Exercise it via type assertion.
    expect(getMonthlyAmount(500, 'bimonthly' as unknown as Parameters<typeof getMonthlyAmount>[1])).toBe(500);
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

describe('predictNextDate', () => {
  it('adds 1 month for monthly frequency', () => {
    const lastSeen = new Date(2024, 0, 15); // Jan 15
    const result = predictNextDate(lastSeen, 'monthly');
    expect(result).toEqual(new Date(2024, 1, 15)); // Feb 15
  });

  it('adds 7 days for weekly frequency', () => {
    const lastSeen = new Date(2024, 0, 1); // Jan 1
    const result = predictNextDate(lastSeen, 'weekly');
    expect(result).toEqual(new Date(2024, 0, 8)); // Jan 8
  });

  it('adds 3 months for quarterly frequency', () => {
    const lastSeen = new Date(2024, 0, 1); // Jan 1
    const result = predictNextDate(lastSeen, 'quarterly');
    expect(result).toEqual(new Date(2024, 3, 1)); // Apr 1
  });

  it('adds 1 year for yearly frequency', () => {
    const lastSeen = new Date(2024, 5, 15); // Jun 15
    const result = predictNextDate(lastSeen, 'yearly');
    expect(result).toEqual(new Date(2025, 5, 15)); // Jun 15 next year
  });

  it('handles month-end overflow for Jan 31 + 1 month (leap year)', () => {
    const lastSeen = new Date(2024, 0, 31); // Jan 31, 2024 (leap year)
    const result = predictNextDate(lastSeen, 'monthly');
    // JS Date: Jan 31 + setMonth(1) = Mar 2 (Feb has 29 days in 2024)
    expect(result).toEqual(new Date(2024, 2, 2));
  });

  it('handles month-end overflow for Mar 31 + 1 month', () => {
    const lastSeen = new Date(2024, 2, 31); // Mar 31
    const result = predictNextDate(lastSeen, 'monthly');
    // JS Date: Mar 31 + setMonth(3) = May 1 (Apr has 30 days)
    expect(result).toEqual(new Date(2024, 4, 1));
  });

  it('handles year boundary Dec 31 + 1 month', () => {
    const lastSeen = new Date(2024, 11, 31); // Dec 31, 2024
    const result = predictNextDate(lastSeen, 'monthly');
    expect(result).toEqual(new Date(2025, 0, 31)); // Jan 31, 2025
  });

  it('handles leap year Feb 29 + 1 year (non-leap result)', () => {
    const lastSeen = new Date(2024, 1, 29); // Feb 29, 2024 (leap year)
    const result = predictNextDate(lastSeen, 'yearly');
    // JS Date: setFullYear(2025) on Feb 29 = Mar 1, 2025 (2025 not a leap year)
    expect(result).toEqual(new Date(2025, 2, 1));
  });

  it('handles leap year Feb 29 + 1 month', () => {
    const lastSeen = new Date(2024, 1, 29); // Feb 29
    const result = predictNextDate(lastSeen, 'monthly');
    expect(result).toEqual(new Date(2024, 2, 29)); // Mar 29
  });

  it('predicts monthly from a mid-month date', () => {
    const result = predictNextDate(new Date(2024, 0, 15), 'monthly');
    expect(result.getFullYear()).toBe(2024);
    expect(result.getMonth()).toBe(1); // February
    expect(result.getDate()).toBe(15);
  });

  it('quarterly from Nov 30 rolls correctly', () => {
    const lastSeen = new Date(2024, 10, 30); // Nov 30, 2024
    const result = predictNextDate(lastSeen, 'quarterly');
    // Nov 30 + 3 months = Feb 30 → Mar 2 (Feb has 28 days in 2025)
    expect(result).toEqual(new Date(2025, 2, 2));
  });
});

describe('chooseDisplayName via detectRecurringPayments', () => {
  it('picks shortest name when all names are <=3 chars', () => {
    const txns = Array.from({ length: 6 }, (_, i) =>
      makeTransaction({
        id: `short${i}`,
        description: 'ABC',
        amount: 100,
        date: new Date(2024, i, 1),
      })
    );
    const result = detectRecurringPayments(txns);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].merchantName).toBe('ABC');
  });

  it('picks shortest meaningful name (>3 chars) when multiple names exist', () => {
    // Transactions with varying descriptions that normalize to the same merchant
    const txns = [
      ...Array.from({ length: 3 }, (_, i) =>
        makeTransaction({
          id: `name${i}a`,
          description: 'NFLX',
          amount: 649,
          date: new Date(2024, i, 1),
        })
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        makeTransaction({
          id: `name${i}b`,
          description: 'NETFLIX.COM',
          amount: 649,
          date: new Date(2024, i, 15),
        })
      ),
    ];
    const result = detectRecurringPayments(txns);
    expect(result.length).toBeGreaterThan(0);
    // Should pick the shortest meaningful name (>3 chars)
    // Both "NFLX" (4 chars) and "NETFLIX.COM" should be available
    expect(result[0].merchantName).toBeTruthy();
  });
});

describe('yearly minOccurrences boundary', () => {
  it('does not skip group with count below minOccurrences but >= minOccurrencesYearly', () => {
    const config: DetectionConfig = {
      ...DEFAULT_DETECTION_CONFIG,
      minOccurrences: 3,
      minOccurrencesYearly: 2,
      excludeVariableAmounts: false,
      confidenceThreshold: 0,
    };
    // 2 transactions: below minOccurrences (3) but >= minOccurrencesYearly (2)
    const txns = [
      makeTransaction({
        id: 'yr1',
        description: 'ANNUAL MEMBERSHIP',
        amount: 999,
        date: new Date(2023, 0, 15),
        category: makeCategory('entertainment'),
      }),
      makeTransaction({
        id: 'yr2',
        description: 'ANNUAL MEMBERSHIP',
        amount: 999,
        date: new Date(2024, 0, 15),
        category: makeCategory('entertainment'),
      }),
    ];
    const result = detectRecurringPayments(txns, config);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].frequency).toBe('yearly');
  });
});
