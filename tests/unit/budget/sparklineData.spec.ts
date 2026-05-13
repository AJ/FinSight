import { describe, it, expect } from 'vitest';
import { computeSparklineData, computeSparklineSVGPoints, getSparklineColor } from '@/lib/budget/sparklineData';
import { makeTransaction, makeCategory } from '@tests/unit/factories';
import { CategoryType } from '@/models';
import '@/lib/categorization/categories';

const groceriesId = 'groceries';
const diningId = 'dining';

describe('computeSparklineData', () => {
  it('returns 5 points by default in chronological order', () => {
    const ref = new Date('2026-04-15');

    const result = computeSparklineData([], groceriesId, 5, ref);

    expect(result).toHaveLength(5);
    const months = result.map(p => p.month);
    expect(months).toEqual(['2025-12', '2026-01', '2026-02', '2026-03', '2026-04']);
  });

  it('aggregates spending per month for category', () => {
    const ref = new Date('2026-04-01');
    const transactions = [
      makeTransaction({ category: makeCategory(groceriesId, CategoryType.Expense), amount: 100, date: new Date('2026-01-10') }),
      makeTransaction({ category: makeCategory(groceriesId, CategoryType.Expense), amount: 200, date: new Date('2026-01-20') }),
      makeTransaction({ category: makeCategory(groceriesId, CategoryType.Expense), amount: 300, date: new Date('2026-02-05') }),
    ];

    const result = computeSparklineData(transactions, groceriesId, 5, ref);

    const jan = result.find(p => p.month === '2026-01')!;
    const feb = result.find(p => p.month === '2026-02')!;
    const dec = result.find(p => p.month === '2025-12')!;
    const mar = result.find(p => p.month === '2026-03')!;
    const apr = result.find(p => p.month === '2026-04')!;

    expect(jan.amount).toBe(300);
    expect(feb.amount).toBe(300);
    expect(dec.amount).toBe(0);
    expect(mar.amount).toBe(0);
    expect(apr.amount).toBe(0);
  });

  it('ignores other categories', () => {
    const ref = new Date('2026-04-01');
    const transactions = [
      makeTransaction({ category: makeCategory(groceriesId, CategoryType.Expense), amount: 500, date: new Date('2026-03-10') }),
      makeTransaction({ category: makeCategory(diningId, CategoryType.Expense), amount: 800, date: new Date('2026-03-10') }),
    ];

    const result = computeSparklineData(transactions, groceriesId, 5, ref);

    const mar = result.find(p => p.month === '2026-03')!;
    expect(mar.amount).toBe(500);
  });

  it('ignores non-expense transactions', () => {
    const ref = new Date('2026-04-01');
    const groceriesExpense = makeCategory(groceriesId, CategoryType.Expense);
    const groceriesIncome = makeCategory(groceriesId, CategoryType.Income);

    const transactions = [
      makeTransaction({ category: groceriesExpense, amount: 500, date: new Date('2026-03-10') }),
      makeTransaction({ category: groceriesIncome, amount: 1000, date: new Date('2026-03-10') }),
    ];

    const result = computeSparklineData(transactions, groceriesId, 5, ref);

    const mar = result.find(p => p.month === '2026-03')!;
    // Only the expense transaction should count
    expect(mar.amount).toBe(500);
  });

  it('uses absolute values for amounts', () => {
    const ref = new Date('2026-04-01');
    const groceriesExpense = makeCategory(groceriesId, CategoryType.Expense);

    const transactions = [
      makeTransaction({ category: groceriesExpense, amount: -250, date: new Date('2026-03-10') }),
    ];

    const result = computeSparklineData(transactions, groceriesId, 5, ref);

    const mar = result.find(p => p.month === '2026-03')!;
    expect(mar.amount).toBe(250);
  });

  it('respects custom months parameter', () => {
    const ref = new Date('2026-04-01');

    const result = computeSparklineData([], groceriesId, 3, ref);

    expect(result).toHaveLength(3);
    const months = result.map(p => p.month);
    expect(months).toEqual(['2026-02', '2026-03', '2026-04']);
  });

  it('respects custom referenceDate', () => {
    const ref = new Date('2026-01-15');

    const result = computeSparklineData([], groceriesId, 5, ref);

    expect(result).toHaveLength(5);
    const months = result.map(p => p.month);
    expect(months).toEqual(['2025-09', '2025-10', '2025-11', '2025-12', '2026-01']);
  });

  it('returns all amounts zero when no matching transactions', () => {
    const ref = new Date('2026-04-01');

    const result = computeSparklineData([], groceriesId, 5, ref);

    expect(result).toHaveLength(5);
    expect(result.every(p => p.amount === 0)).toBe(true);
  });
});

describe('computeSparklineSVGPoints', () => {
  it('returns empty result for single data point', () => {
    const result = computeSparklineSVGPoints([{ month: '2026-01', amount: 100 }]);
    expect(result.polyline).toBe('');
    expect(result.dots).toEqual([]);
  });

  it('returns empty result for empty data', () => {
    const result = computeSparklineSVGPoints([]);
    expect(result.polyline).toBe('');
    expect(result.dots).toEqual([]);
  });

  it('computes coordinates for flat data', () => {
    const data = [
      { month: '2026-01', amount: 100 },
      { month: '2026-02', amount: 100 },
      { month: '2026-03', amount: 100 },
    ];

    const { polyline, dots } = computeSparklineSVGPoints(data, 100, 28, 5, 6, 6);

    expect(dots).toHaveLength(3);
    // All amounts equal, so all dots should share the same y
    const ys = dots.map(d => d.y);
    expect(ys.every(y => y === ys[0])).toBe(true);
    // X values should be evenly spaced
    expect(dots[0].x).toBeCloseTo(5);
    expect(dots[2].x).toBeCloseTo(95);
    // Polyline should contain all dot coordinates
    expect(polyline).toContain(`${dots[0].x},${dots[0].y}`);
  });

  it('computes rising line for increasing data', () => {
    const data = [
      { month: '2026-01', amount: 100 },
      { month: '2026-02', amount: 200 },
      { month: '2026-03', amount: 300 },
    ];

    const { dots } = computeSparklineSVGPoints(data, 100, 28, 5, 6, 6);

    // First point (lowest) should have highest y (SVG y goes down)
    expect(dots[0].y).toBeGreaterThan(dots[1].y);
    expect(dots[1].y).toBeGreaterThan(dots[2].y);
  });

  it('respects custom dimensions and padding', () => {
    const data = [
      { month: '2026-01', amount: 0 },
      { month: '2026-02', amount: 100 },
    ];

    const { dots } = computeSparklineSVGPoints(data, 200, 50, 10, 8, 8);

    expect(dots).toHaveLength(2);
    // First dot at paddingX=10, last at width-paddingX=190
    expect(dots[0].x).toBeCloseTo(10);
    expect(dots[1].x).toBeCloseTo(190);
    // Max value (100) should be at top (y = height - paddingBottom = 50 - 8 = 42)
    // Min value (0) should be at bottom (y = 50 - 8 = 42... wait, min=0 so y = 50-8-(0/100)*34 = 42)
    // Actually: max = 100, drawHeight = 50 - 8 - 8 = 34
    // dot[0] amount=0: y = 50 - 8 - (0/100)*34 = 42
    // dot[1] amount=100: y = 50 - 8 - (100/100)*34 = 8
    expect(dots[0].y).toBeCloseTo(42);
    expect(dots[1].y).toBeCloseTo(8);
  });

  it('handles all-zero amounts without division by zero', () => {
    const data = [
      { month: '2026-01', amount: 0 },
      { month: '2026-02', amount: 0 },
      { month: '2026-03', amount: 0 },
    ];

    const { dots, polyline } = computeSparklineSVGPoints(data);

    expect(dots).toHaveLength(3);
    expect(polyline).not.toBe('');
    // All y values should be equal (bottom of chart)
    const ys = dots.map(d => d.y);
    expect(ys.every(y => y === ys[0])).toBe(true);
  });
});

describe('getSparklineColor', () => {
  it('returns red for 100% and above', () => {
    expect(getSparklineColor(100)).toBe('#ef4444');
    expect(getSparklineColor(150)).toBe('#ef4444');
  });

  it('returns yellow for 80-99%', () => {
    expect(getSparklineColor(80)).toBe('#eab308');
    expect(getSparklineColor(99)).toBe('#eab308');
  });

  it('returns green for under 80%', () => {
    expect(getSparklineColor(79)).toBe('#22c55e');
    expect(getSparklineColor(0)).toBe('#22c55e');
    expect(getSparklineColor(50)).toBe('#22c55e');
  });
});
