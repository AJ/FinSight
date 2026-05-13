import { describe, it, expect } from 'vitest';
import {
  normalizeTransactionDates,
  shouldUseWeeklyPeriods,
  buildWeeklyPeriods,
  buildMonthlyPeriods,
  aggregateByPeriod,
  buildTrendData,
} from '@/components/dashboard/trendLineChartData';

describe('normalizeTransactionDates', () => {
  it('converts Date instances and filters invalid', () => {
    const txns = [
      { date: new Date('2025-03-10'), amount: 100, category: null },
      { date: new Date('invalid'), amount: 200, category: null },
    ];

    const result = normalizeTransactionDates(txns);
    expect(result).toHaveLength(1);
    expect(result[0].dateObj).toEqual(new Date('2025-03-10'));
  });

  it('returns empty for empty input', () => {
    expect(normalizeTransactionDates([])).toEqual([]);
  });
});

describe('shouldUseWeeklyPeriods', () => {
  it('returns true for 7 or fewer weeks', () => {
    const first = new Date(2025, 0, 6);
    const last = new Date(2025, 0, 12);
    expect(shouldUseWeeklyPeriods(first, last)).toBe(true);
  });

  it('returns false for more than 7 weeks', () => {
    const first = new Date(2025, 0, 1);
    const last = new Date(2025, 2, 31);
    expect(shouldUseWeeklyPeriods(first, last)).toBe(false);
  });
});

describe('buildWeeklyPeriods', () => {
  it('generates weekly periods from first to last', () => {
    const first = new Date(2025, 0, 6);
    const last = new Date(2025, 0, 19);

    const periods = buildWeeklyPeriods(first, last);
    expect(periods.length).toBeGreaterThanOrEqual(2);
    expect(periods[0].label).toBeTruthy();
  });
});

describe('buildMonthlyPeriods', () => {
  it('generates monthly periods', () => {
    const first = new Date(2025, 0, 15);
    const last = new Date(2025, 2, 20);

    const periods = buildMonthlyPeriods(first, last);
    expect(periods).toHaveLength(3);
    expect(periods[0].label).toBe('Jan 2025');
    expect(periods[2].label).toBe('Mar 2025');
  });

  it('caps at maxMonths', () => {
    const first = new Date(2024, 0, 1);
    const last = new Date(2025, 11, 31);

    const periods = buildMonthlyPeriods(first, last, 12);
    expect(periods).toHaveLength(12);
  });
});

describe('aggregateByPeriod', () => {
  it('aggregates income and expenses per period', () => {
    const txns = [
      { dateObj: new Date(2025, 0, 10), amount: 5000, category: { isIncome: true } },
      { dateObj: new Date(2025, 0, 15), amount: 2000, category: { isExpense: true } },
      { dateObj: new Date(2025, 1, 10), amount: 3000, category: { isIncome: true } },
    ];

    const periods = [
      { start: new Date(2025, 0, 1), end: new Date(2025, 0, 31), label: 'Jan 2025' },
      { start: new Date(2025, 1, 1), end: new Date(2025, 1, 28), label: 'Feb 2025' },
    ];

    const { incomeByPeriod, expensesByPeriod } = aggregateByPeriod(txns, periods);
    expect(incomeByPeriod).toEqual([5000, 3000]);
    expect(expensesByPeriod).toEqual([2000, 0]);
  });

  it('returns zeros for empty periods', () => {
    const periods = [
      { start: new Date(2025, 0, 1), end: new Date(2025, 0, 31), label: 'Jan' },
    ];

    const { incomeByPeriod, expensesByPeriod } = aggregateByPeriod([], periods);
    expect(incomeByPeriod).toEqual([0]);
    expect(expensesByPeriod).toEqual([0]);
  });
});

describe('buildTrendData', () => {
  it('returns empty for no transactions', () => {
    const result = buildTrendData([]);
    expect(result.labels).toEqual([]);
    expect(result.incomeByPeriod).toEqual([]);
    expect(result.expensesByPeriod).toEqual([]);
  });

  it('builds monthly trend for long date ranges', () => {
    const txns = [
      { date: new Date(2025, 0, 10), amount: 5000, category: { isIncome: true } },
      { date: new Date(2025, 0, 15), amount: 2000, category: { isExpense: true } },
      { date: new Date(2025, 5, 10), amount: 3000, category: { isIncome: true } },
      { date: new Date(2025, 5, 15), amount: 1000, category: { isExpense: true } },
    ];

    const result = buildTrendData(txns);
    expect(result.isWeekly).toBe(false);
    expect(result.labels).toHaveLength(6); // Jan through Jun
    expect(result.incomeByPeriod[0]).toBe(5000);  // Jan income
    expect(result.expensesByPeriod[0]).toBe(2000); // Jan expenses
    expect(result.incomeByPeriod[5]).toBe(3000);  // Jun income
    expect(result.expensesByPeriod[5]).toBe(1000); // Jun expenses
  });

  it('builds weekly trend for short date ranges', () => {
    const txns = [
      { date: new Date(2025, 0, 6), amount: 1000, category: { isIncome: true } },
      { date: new Date(2025, 0, 8), amount: 500, category: { isExpense: true } },
    ];

    const result = buildTrendData(txns);
    expect(result.isWeekly).toBe(true);
    expect(result.labels.length).toBeGreaterThanOrEqual(1);
  });

  it('handles all invalid dates', () => {
    const txns = [
      { date: new Date('invalid'), amount: 100, category: null },
    ];

    const result = buildTrendData(txns);
    expect(result.labels).toEqual([]);
  });
});

describe('shouldUseWeeklyPeriods', () => {
  it('returns true at exactly 7-week boundary', () => {
    const first = new Date(2025, 0, 6);
    const last = new Date(2025, 1, 17); // ~6 weeks apart
    expect(shouldUseWeeklyPeriods(first, last)).toBe(true);
  });

  it('returns true for same date (0 weeks)', () => {
    const d = new Date(2025, 0, 15);
    expect(shouldUseWeeklyPeriods(d, d)).toBe(true);
  });
});

describe('buildWeeklyPeriods', () => {
  it('produces single period for same-week dates', () => {
    const first = new Date(2025, 0, 6); // Monday
    const last = new Date(2025, 0, 8); // Wednesday same week

    const periods = buildWeeklyPeriods(first, last);
    expect(periods).toHaveLength(1);
  });

  it('snaps mid-week start date to Monday', () => {
    const wed = new Date(2025, 0, 8); // Wednesday
    const fri = new Date(2025, 0, 10); // Friday same week

    const periods = buildWeeklyPeriods(wed, fri);
    expect(periods).toHaveLength(1);
    expect(periods[0].start.getDay()).toBe(1); // Monday
  });
});

describe('buildMonthlyPeriods', () => {
  it('produces single period for same-month dates', () => {
    const first = new Date(2025, 0, 10);
    const last = new Date(2025, 0, 25);

    const periods = buildMonthlyPeriods(first, last);
    expect(periods).toHaveLength(1);
    expect(periods[0].label).toBe('Jan 2025');
  });

  it('returns empty for maxMonths 0', () => {
    const first = new Date(2025, 0, 1);
    const last = new Date(2025, 2, 31);

    const periods = buildMonthlyPeriods(first, last, 0);
    expect(periods).toEqual([]);
  });
});

describe('aggregateByPeriod', () => {
  it('handles transactions with null category (neither income nor expense)', () => {
    const txns = [
      { dateObj: new Date(2025, 0, 10), amount: 100, category: null },
    ];
    const periods = [
      { start: new Date(2025, 0, 1), end: new Date(2025, 0, 31), label: 'Jan' },
    ];

    const { incomeByPeriod, expensesByPeriod } = aggregateByPeriod(txns, periods);
    expect(incomeByPeriod).toEqual([0]);
    expect(expensesByPeriod).toEqual([0]);
  });

  it('handles negative amounts via Math.abs', () => {
    const txns = [
      { dateObj: new Date(2025, 0, 10), amount: -500, category: { isExpense: true } },
    ];
    const periods = [
      { start: new Date(2025, 0, 1), end: new Date(2025, 0, 31), label: 'Jan' },
    ];

    const { expensesByPeriod } = aggregateByPeriod(txns, periods);
    expect(expensesByPeriod).toEqual([500]);
  });

  it('returns empty arrays for empty periods', () => {
    const { incomeByPeriod, expensesByPeriod } = aggregateByPeriod([], []);
    expect(incomeByPeriod).toEqual([]);
    expect(expensesByPeriod).toEqual([]);
  });
});

describe('buildTrendData', () => {
  it('handles single transaction', () => {
    const result = buildTrendData([
      { date: new Date(2025, 0, 10), amount: 500, category: { isIncome: true } },
    ]);

    expect(result.labels).toHaveLength(1);
    expect(result.isWeekly).toBe(true);
  });
});
