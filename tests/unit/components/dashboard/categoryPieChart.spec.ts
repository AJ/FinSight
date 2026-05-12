import { describe, it, expect } from 'vitest';
import {
  aggregateSpendByCategory,
  buildPieChartData,
  reorderForContrast,
  type CategoryLike,
} from '@/components/dashboard/categoryPieChartData';

describe('aggregateSpendByCategory', () => {
  it('groups amounts by category id', () => {
    const txns = [
      { amount: 100, category: { id: 'food', isExpense: true } },
      { amount: 200, category: { id: 'food', isExpense: true } },
      { amount: 150, category: { id: 'transport', isExpense: true } },
    ];

    const result = aggregateSpendByCategory(txns);
    expect(result.food).toBe(300);
    expect(result.transport).toBe(150);
  });

  it('uses absolute values for amounts', () => {
    const txns = [
      { amount: -100, category: { id: 'food', isExpense: true } },
    ];

    expect(aggregateSpendByCategory(txns).food).toBe(100);
  });

  it('uses "uncategorized" for missing category', () => {
    const txns = [
      { amount: 50, category: null },
      { amount: 30, category: { id: undefined } },
    ];

    const result = aggregateSpendByCategory(txns);
    expect(result.uncategorized).toBe(80);
  });

  it('returns empty for empty input', () => {
    expect(aggregateSpendByCategory([])).toEqual({});
  });

  it('only includes expense categories in spending aggregation', () => {
    const txns = [
      { amount: 100, category: { id: 'food', isIncome: false, isExpense: true } },
      { amount: 5000, category: { id: 'salary', isIncome: true, isExpense: false } },
      { amount: 200, category: { id: 'transfer', isIncome: false, isExpense: false } },
      { amount: 150, category: { id: 'transport', isIncome: false, isExpense: true } },
    ];

    const result = aggregateSpendByCategory(txns);
    expect(result.food).toBe(100);
    expect(result.transport).toBe(150);
    expect(result.salary).toBeUndefined();
    expect(result.transfer).toBeUndefined();
  });
});

describe('buildPieChartData', () => {
  const lookup = (id: string): CategoryLike => ({
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    color: id === 'food' ? '#ff0000' : '#0000ff',
  });

  it('builds chart data with labels, data, and colors', () => {
    const byCategory = { food: 300, transport: 200, entertainment: 100 };

    const result = buildPieChartData(byCategory, lookup);
    expect(result.labels).toHaveLength(3);
    expect(result.data).toEqual([300, 200, 100]);
    expect(result.colors).toEqual(['#ff0000', '#0000ff', '#0000ff']);
  });

  it('includes percentage in labels', () => {
    const byCategory = { food: 75, transport: 25 };

    const result = buildPieChartData(byCategory, lookup);
    expect(result.labels[0]).toBe('Food (75.0%)');
    expect(result.labels[1]).toBe('Transport (25.0%)');
  });

  it('slices to maxSlices', () => {
    const byCategory: Record<string, number> = {};
    for (let i = 0; i < 15; i++) {
      byCategory[`cat${i}`] = 15 - i;
    }

    const result = buildPieChartData(byCategory, lookup, 5);
    expect(result.labels).toHaveLength(5);
    expect(result.data).toHaveLength(5);
  });

  it('returns empty for empty input', () => {
    const result = buildPieChartData({}, lookup);
    expect(result.labels).toEqual([]);
    expect(result.data).toEqual([]);
    expect(result.colors).toEqual([]);
  });

  it('uses fallback name and color when lookup returns minimal info', () => {
    const minimalLookup = (id: string): CategoryLike => ({});
    const byCategory = { unknown_cat: 100 };

    const result = buildPieChartData(byCategory, minimalLookup);
    expect(result.labels[0]).toContain('unknown_cat');
    expect(result.colors[0]).toBe('#6b7280');
  });
});

describe('reorderForContrast', () => {
  it('returns items as-is for 2 or fewer', () => {
    const items = [{ color: '#ff0000' }, { color: '#0000ff' }];
    expect(reorderForContrast(items)).toEqual(items);
  });

  it('spaces similar colors apart', () => {
    const items = [
      { color: '#ff0000' }, // red
      { color: '#ff1111' }, // near-red
      { color: '#0000ff' }, // blue
    ];

    const result = reorderForContrast(items);
    // First stays red. Next should be blue (most different from red).
    // Near-red should be last.
    expect(result[0].color).toBe('#ff0000');
    expect(result[1].color).toBe('#0000ff');
    expect(result[2].color).toBe('#ff1111');
  });

  it('handles all same colors', () => {
    const items = [
      { color: '#aaaaaa' },
      { color: '#aaaaaa' },
      { color: '#aaaaaa' },
    ];

    const result = reorderForContrast(items);
    expect(result).toHaveLength(3);
  });
});
