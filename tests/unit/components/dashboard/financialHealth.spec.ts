import { describe, it, expect } from 'vitest';
import {
  calculateSavingsTrend,
  calculateSavingsRate,
  calculateFinancialHealthScore,
  getScoreLabel,
  buildHealthMetrics,
  computeMonthlyFinancials,
} from '@/components/dashboard/financialHealth';

function txn(date: string, amount: number, type: 'income' | 'expense') {
  return {
    date: new Date(date),
    isIncome: type === 'income',
    isExpense: type === 'expense',
    amount,
  };
}

describe('calculateSavingsTrend', () => {
  it('computes percentage change when previous savings nonzero', () => {
    expect(calculateSavingsTrend(3000, 2000)).toBe(50);
    expect(calculateSavingsTrend(1000, 2000)).toBe(-50);
  });

  it('returns 100 when previous is 0 and recent is positive', () => {
    expect(calculateSavingsTrend(500, 0)).toBe(100);
  });

  it('returns -100 when previous is 0 and recent is negative', () => {
    expect(calculateSavingsTrend(-300, 0)).toBe(-100);
  });

  it('returns 0 when both are zero', () => {
    expect(calculateSavingsTrend(0, 0)).toBe(0);
  });

  it('handles negative previous savings', () => {
    const result = calculateSavingsTrend(1000, -500);
    expect(result).toBe(((1000 - (-500)) / 500) * 100);
  });
});

describe('calculateSavingsRate', () => {
  it('computes rate as percentage of income', () => {
    expect(calculateSavingsRate(3000, 10000)).toBe(30);
  });

  it('returns -100 when income is 0 and savings negative', () => {
    expect(calculateSavingsRate(-500, 0)).toBe(-100);
  });

  it('returns 0 when income is 0 and savings non-negative', () => {
    expect(calculateSavingsRate(0, 0)).toBe(0);
    expect(calculateSavingsRate(100, 0)).toBe(0);
  });
});

describe('calculateFinancialHealthScore', () => {
  it('starts at 50 base with savings rate 0 and no CC data', () => {
    expect(calculateFinancialHealthScore(0, 0, false)).toBe(65); // 50 + 5 (savings) + 10 (no CC)
  });

  it('adds 30 for savingsRate >= 30', () => {
    expect(calculateFinancialHealthScore(30, 0, true)).toBe(100); // 50 + 30 + 20 (util <= 30)
  });

  it('adds 25 for savingsRate >= 20', () => {
    expect(calculateFinancialHealthScore(20, 0, true)).toBe(95); // 50 + 25 + 20
  });

  it('adds 15 for savingsRate >= 10', () => {
    expect(calculateFinancialHealthScore(10, 0, true)).toBe(85); // 50 + 15 + 20
  });

  it('adds 5 for savingsRate >= 0', () => {
    expect(calculateFinancialHealthScore(0, 0, true)).toBe(75); // 50 + 5 + 20
  });

  it('subtracts 5 for savingsRate >= -10', () => {
    expect(calculateFinancialHealthScore(-5, 0, true)).toBe(65); // 50 - 5 + 20
  });

  it('subtracts 15 for savingsRate >= -25', () => {
    expect(calculateFinancialHealthScore(-20, 0, true)).toBe(55); // 50 - 15 + 20
  });

  it('subtracts 25 for savingsRate < -25', () => {
    expect(calculateFinancialHealthScore(-30, 0, true)).toBe(45); // 50 - 25 + 20
  });

  it('adds 10 for utilization <= 30%', () => {
    expect(calculateFinancialHealthScore(0, 30, true)).toBe(75); // 50 + 5 + 20
  });

  it('adds 10 for utilization <= 50%', () => {
    expect(calculateFinancialHealthScore(0, 50, true)).toBe(65); // 50 + 5 + 10
  });

  it('adds 0 for utilization <= 70%', () => {
    expect(calculateFinancialHealthScore(0, 70, true)).toBe(55); // 50 + 5 + 0
  });

  it('subtracts 10 for utilization > 70%', () => {
    expect(calculateFinancialHealthScore(0, 80, true)).toBe(45); // 50 + 5 - 10
  });

  it('adds 10 for no CC data regardless of utilization', () => {
    expect(calculateFinancialHealthScore(0, 80, false)).toBe(65); // 50 + 5 + 10
  });

  it('produces minimum score with worst-case inputs', () => {
    // Current tiers produce floor of 15: 50 - 25 (savings) - 10 (util)
    expect(calculateFinancialHealthScore(-50, 100, true)).toBe(15);
  });

  it('tests exact boundary at savingsRate -10', () => {
    // -10 falls into >= -10 tier (subtracts 5)
    expect(calculateFinancialHealthScore(-10, 0, true)).toBe(65); // 50 - 5 + 20
  });

  it('tests exact boundary at savingsRate -25', () => {
    // -25 falls into >= -25 tier (subtracts 15)
    expect(calculateFinancialHealthScore(-25, 0, true)).toBe(55); // 50 - 15 + 20
  });

  it('clamps score to 100 maximum', () => {
    expect(calculateFinancialHealthScore(50, 0, true)).toBe(100);
  });
});

describe('getScoreLabel', () => {
  it('returns Excellent for >= 80', () => {
    expect(getScoreLabel(80)).toBe('Excellent');
    expect(getScoreLabel(95)).toBe('Excellent');
  });

  it('returns Good for >= 60', () => {
    expect(getScoreLabel(60)).toBe('Good');
    expect(getScoreLabel(79)).toBe('Good');
  });

  it('returns Fair for >= 40', () => {
    expect(getScoreLabel(40)).toBe('Fair');
    expect(getScoreLabel(59)).toBe('Fair');
  });

  it('returns Needs Work for < 40', () => {
    expect(getScoreLabel(39)).toBe('Needs Work');
    expect(getScoreLabel(0)).toBe('Needs Work');
  });
});

describe('buildHealthMetrics', () => {
  it('shows N/A for utilization when no CC data', () => {
    const metrics = buildHealthMetrics(10, 0, false);
    expect(metrics[0].status).toBe('N/A');
    expect(metrics[0].statusType).toBe('good');
  });

  it('shows Good utilization <= 30%', () => {
    const metrics = buildHealthMetrics(10, 30, true);
    expect(metrics[0].status).toBe('Good');
    expect(metrics[0].statusType).toBe('good');
  });

  it('shows OK utilization <= 50%', () => {
    const metrics = buildHealthMetrics(10, 50, true);
    expect(metrics[0].status).toBe('OK');
    expect(metrics[0].statusType).toBe('warning');
  });

  it('shows High utilization > 50%', () => {
    const metrics = buildHealthMetrics(10, 60, true);
    expect(metrics[0].status).toBe('High');
    expect(metrics[0].statusType).toBe('bad');
  });

  it('shows Excellent savings >= 20%', () => {
    const metrics = buildHealthMetrics(25, 0, false);
    expect(metrics[1].status).toBe('Excellent');
    expect(metrics[1].statusType).toBe('good');
  });

  it('shows Good savings >= 10%', () => {
    const metrics = buildHealthMetrics(15, 0, false);
    expect(metrics[1].status).toBe('Good');
    expect(metrics[1].statusType).toBe('warning');
  });

  it('shows Low savings >= 0%', () => {
    const metrics = buildHealthMetrics(5, 0, false);
    expect(metrics[1].status).toBe('Low');
    expect(metrics[1].statusType).toBe('bad');
  });

  it('shows Overspent for negative savings rate', () => {
    const metrics = buildHealthMetrics(-5, 0, false);
    expect(metrics[1].status).toBe('Overspent');
    expect(metrics[1].statusType).toBe('bad');
  });

  it('clamps savings value to 0 for progress bar when negative', () => {
    const metrics = buildHealthMetrics(-10, 0, false);
    expect(metrics[1].value).toBe(0);
  });

  it('returns only utilization and savings metrics (no fake bills)', () => {
    const metrics = buildHealthMetrics(0, 0, false);
    expect(metrics).toHaveLength(2);
    expect(metrics.map((m) => m.label)).toEqual(['Utilization', 'Savings']);
  });
});

describe('computeMonthlyFinancials', () => {
  it('returns hasData false for empty transactions', () => {
    const result = computeMonthlyFinancials([], 0, false);
    expect(result).toEqual({ hasData: false });
  });

  it('returns hasData false when all dates are invalid', () => {
    const result = computeMonthlyFinancials([
      { date: new Date('invalid'), isIncome: true, isExpense: false, amount: 100 },
    ], 0, false);
    expect(result).toEqual({ hasData: false });
  });

  it('computes single-month financials with no previous month', () => {
    const result = computeMonthlyFinancials([
      txn('2025-03-10', 5000, 'income'),
      txn('2025-03-15', 2000, 'expense'),
      txn('2025-03-20', 1500, 'expense'),
    ], 0, false);

    expect(result.hasData).toBe(true);
    if (!result.hasData) return;
    expect(result.recentIncome).toBe(5000);
    expect(result.recentExpenses).toBe(3500);
    expect(result.recentSavings).toBe(1500);
    expect(result.savingsRate).toBe(30);
    expect(result.savingsTrend).toBe(100); // prev month = 0, recent > 0
    expect(result.projectedAnnualSavings).toBe(18000); // 1500/month * 12
    expect(result.monthDisplay).toBe('Mar 2025');
    expect(result.isNegativeSavings).toBe(false);
  });

  it('computes trend correctly across two months', () => {
    const result = computeMonthlyFinancials([
      txn('2025-03-10', 5000, 'income'),
      txn('2025-03-15', 2000, 'expense'),
      txn('2025-02-10', 4000, 'income'),
      txn('2025-02-15', 1000, 'expense'),
    ], 0, false);

    expect(result.hasData).toBe(true);
    if (!result.hasData) return;
    // All-time: income 9000, expenses 3000, savings 6000
    expect(result.recentSavings).toBe(6000);
    expect(result.recentIncome).toBe(9000);
    // Month trend: March savings 3000, Feb savings 3000 → 0% change
    expect(result.savingsTrend).toBe(0);
  });

  it('handles negative savings (overspending)', () => {
    const result = computeMonthlyFinancials([
      txn('2025-03-10', 2000, 'income'),
      txn('2025-03-15', 3000, 'expense'),
    ], 0.5, true);

    expect(result.hasData).toBe(true);
    if (!result.hasData) return;
    expect(result.recentSavings).toBe(-1000);
    expect(result.isNegativeSavings).toBe(true);
    expect(result.savingsRate).toBe(-50);
  });

  it('integrates credit utilization into score', () => {
    const lowUtil = computeMonthlyFinancials([
      txn('2025-03-10', 5000, 'income'),
    ], 0.2, true); // 20% utilization
    const highUtil = computeMonthlyFinancials([
      txn('2025-03-10', 5000, 'income'),
    ], 0.8, true); // 80% utilization

    expect(lowUtil.hasData).toBe(true);
    expect(highUtil.hasData).toBe(true);
    if (!lowUtil.hasData || !highUtil.hasData) return;
    expect(lowUtil.score).toBeGreaterThan(highUtil.score);
  });

  it('computes all-time totals across multiple months', () => {
    const result = computeMonthlyFinancials([
      txn('2025-01-10', 10000, 'income'),
      txn('2025-03-10', 5000, 'income'),
      txn('2025-02-10', 7000, 'income'),
    ], 0, false);

    expect(result.hasData).toBe(true);
    if (!result.hasData) return;
    expect(result.recentIncome).toBe(22000); // all-time total
    expect(result.monthDisplay).toBe('Jan 2025 – Mar 2025');
  });

  it('includes all expected fields in result', () => {
    const result = computeMonthlyFinancials([
      txn('2025-03-10', 5000, 'income'),
    ], 0, false);

    expect(result.hasData).toBe(true);
    if (!result.hasData) return;
    expect(result).toHaveProperty('recentIncome');
    expect(result).toHaveProperty('recentExpenses');
    expect(result).toHaveProperty('recentSavings');
    expect(result).toHaveProperty('savingsRate');
    expect(result).toHaveProperty('savingsTrend');
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('scoreLabel');
    expect(result).toHaveProperty('metrics');
    expect(result).toHaveProperty('projectedAnnualSavings');
    expect(result).toHaveProperty('monthDisplay');
    expect(result).toHaveProperty('isNegativeSavings');
  });
});
