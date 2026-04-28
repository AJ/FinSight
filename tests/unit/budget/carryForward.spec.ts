import { describe, it, expect } from 'vitest';
import { findCarryForwardState } from '@/lib/budget/carryForward';
import { makeBudgetPeriod } from '@tests/unit/factories';
import type { BudgetPeriod } from '@/types';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a period map from an array of BudgetPeriod objects. */
function periodMap(...periods: BudgetPeriod[]): Record<string, BudgetPeriod> {
  const map: Record<string, BudgetPeriod> = {};
  for (const p of periods) {
    map[p.month] = p;
  }
  return map;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('findCarryForwardState', () => {
  // 1. Returns existing period when month has one
  it('returns existing period data when the target month has a budget', () => {
    const periods = periodMap(
      makeBudgetPeriod({
        month: '2026-04',
        income: 55000,
        allocations: [
          { categoryId: 'groceries', amount: 12000 },
          { categoryId: 'dining', amount: 6000 },
        ],
        hiddenCategories: ['travel'],
      }),
    );

    const result = findCarryForwardState({ month: '2026-04', periods });

    expect(result.income).toBe(55000);
    expect(result.allocations).toEqual({ groceries: 12000, dining: 6000 });
    expect(result.hidden).toEqual(['travel']);
  });

  // 2. Carries forward from most recent previous month
  it('carries forward from the most recent previous month', () => {
    const periods = periodMap(
      makeBudgetPeriod({
        month: '2026-01',
        income: 40000,
        allocations: [{ categoryId: 'groceries', amount: 8000 }],
        hiddenCategories: [],
      }),
      makeBudgetPeriod({
        month: '2026-02',
        income: 45000,
        allocations: [{ categoryId: 'groceries', amount: 9000 }],
        hiddenCategories: ['entertainment'],
      }),
      makeBudgetPeriod({
        month: '2026-03',
        income: 50000,
        allocations: [{ categoryId: 'groceries', amount: 10000 }],
        hiddenCategories: ['travel', 'education'],
      }),
    );

    const result = findCarryForwardState({ month: '2026-04', periods });

    // Should carry from 2026-03, the most recent previous month
    expect(result.income).toBe(50000);
    expect(result.allocations).toEqual({ groceries: 10000 });
    expect(result.hidden).toEqual(['travel', 'education']);
  });

  // 3. Skips months with no budget (gaps in periods)
  it('skips gaps and carries from the nearest earlier month', () => {
    const periods = periodMap(
      makeBudgetPeriod({
        month: '2025-11',
        income: 35000,
        allocations: [{ categoryId: 'housing', amount: 15000 }],
        hiddenCategories: ['shopping'],
      }),
      // 2025-12 and 2026-01 have no budget entries
      makeBudgetPeriod({
        month: '2026-02',
        income: 42000,
        allocations: [{ categoryId: 'housing', amount: 18000 }],
        hiddenCategories: [],
      }),
    );

    const result = findCarryForwardState({ month: '2026-04', periods });

    // Should carry from 2026-02 (skipping the gap to 2026-04)
    expect(result.income).toBe(42000);
    expect(result.allocations).toEqual({ housing: 18000 });
  });

  // 4. Returns zeros when no previous months exist
  it('returns zeros when periods map is empty', () => {
    const result = findCarryForwardState({ month: '2026-04', periods: {} });

    expect(result.income).toBe(0);
    expect(result.allocations).toEqual({});
    expect(result.hidden).toEqual([]);
  });

  // 5. Returns zeros when all previous months are after target
  it('returns zeros when no previous month exists before the target', () => {
    const periods = periodMap(
      makeBudgetPeriod({
        month: '2026-05',
        income: 60000,
        allocations: [{ categoryId: 'dining', amount: 7000 }],
        hiddenCategories: [],
      }),
      makeBudgetPeriod({
        month: '2026-06',
        income: 65000,
        allocations: [{ categoryId: 'dining', amount: 8000 }],
        hiddenCategories: [],
      }),
    );

    const result = findCarryForwardState({ month: '2026-04', periods });

    expect(result.income).toBe(0);
    expect(result.allocations).toEqual({});
    expect(result.hidden).toEqual([]);
  });

  // 6. Copies hidden categories from source period
  it('copies hidden categories from the source period', () => {
    const periods = periodMap(
      makeBudgetPeriod({
        month: '2026-03',
        income: 50000,
        allocations: [{ categoryId: 'groceries', amount: 10000 }],
        hiddenCategories: ['travel', 'education', 'entertainment'],
      }),
    );

    const result = findCarryForwardState({ month: '2026-04', periods });

    expect(result.hidden).toEqual(['travel', 'education', 'entertainment']);
  });

  // 7. Deep copies allocations (modifying result doesn't mutate source)
  it('deep copies allocations so mutating the result does not affect the source', () => {
    const periods = periodMap(
      makeBudgetPeriod({
        month: '2026-03',
        income: 50000,
        allocations: [{ categoryId: 'groceries', amount: 10000 }],
        hiddenCategories: ['travel'],
      }),
    );

    const result = findCarryForwardState({ month: '2026-04', periods });

    // Mutate result
    result.allocations['groceries'] = 99999;
    result.hidden.push('hacked');

    // Source should be untouched
    expect(periods['2026-03']!.allocations[0]!.amount).toBe(10000);
    expect(periods['2026-03']!.hiddenCategories).toEqual(['travel']);
  });

  // 8. Handles year boundary correctly
  it('carries forward across year boundaries (2025-12 to 2026-02)', () => {
    const periods = periodMap(
      makeBudgetPeriod({
        month: '2025-11',
        income: 30000,
        allocations: [{ categoryId: 'groceries', amount: 6000 }],
        hiddenCategories: [],
      }),
      makeBudgetPeriod({
        month: '2025-12',
        income: 48000,
        allocations: [
          { categoryId: 'groceries', amount: 10000 },
          { categoryId: 'dining', amount: 5000 },
        ],
        hiddenCategories: ['insurance'],
      }),
      // 2026-01 has no budget
    );

    const result = findCarryForwardState({ month: '2026-02', periods });

    // Should carry from 2025-12 (string comparison: '2025-12' < '2026-02')
    expect(result.income).toBe(48000);
    expect(result.allocations).toEqual({ groceries: 10000, dining: 5000 });
    expect(result.hidden).toEqual(['insurance']);
  });
});
