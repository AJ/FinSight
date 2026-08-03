import { describe, it, expect } from 'vitest';
import { SourceType } from '@/types';
import { makeTransaction, makeCategory } from '@tests/unit/factories';

import {
  applyFilters,
  activeAnomalyCount,
  hasFilters,
  isAllSelected,
  NO_FILTERS,
  type FilterState,
} from '@/app/transactions/pageFilters';

// Realistic fixtures spanning every role / source / category the filters discriminate on.
// Dates are distinct so sort order is observable.
function fixtures() {
  return {
    groceriesBank: makeTransaction({
      id: 'groceries',
      description: 'SWIGGY FOOD ORDER',
      amount: 350,
      type: 'debit',
      transactionSubType: 'purchase',
      sourceType: SourceType.Bank,
      category: makeCategory('groceries'),
      date: '2024-01-10',
    }),
    salaryBank: makeTransaction({
      id: 'salary',
      description: 'ACME CORP SALARY',
      amount: 50000,
      type: 'credit',
      transactionSubType: 'income',
      sourceType: SourceType.Bank,
      category: makeCategory('income'),
      date: '2024-01-05',
    }),
    transferBank: makeTransaction({
      id: 'transfer',
      description: 'TRANSFER TO SAVINGS',
      amount: 1000,
      type: 'debit',
      transactionSubType: 'self_transfer',
      sourceType: SourceType.Bank,
      category: makeCategory('transfer'),
      date: '2024-01-08',
    }),
    shoppingCcAnomaly: makeTransaction({
      id: 'amazon',
      description: 'AMAZON PURCHASE',
      amount: 1299,
      type: 'debit',
      transactionSubType: 'purchase',
      sourceType: SourceType.CreditCard,
      category: makeCategory('shopping'),
      date: '2024-01-15',
      isAnomaly: true,
    }),
    diningBankDismissedAnomaly: makeTransaction({
      id: 'starbucks',
      description: 'STARBUCKS COFFEE',
      amount: 250,
      type: 'debit',
      transactionSubType: 'purchase',
      sourceType: SourceType.Bank,
      category: makeCategory('dining'),
      date: '2024-01-12',
      isAnomaly: true,
      anomalyDismissed: true,
    }),
    needsReview: makeTransaction({
      id: 'netflix',
      description: 'NETFLIX SUBSCRIPTION',
      amount: 649,
      type: 'debit',
      transactionSubType: 'purchase',
      sourceType: SourceType.Bank,
      category: makeCategory('entertainment'),
      date: '2024-01-20',
      reviewReasons: ['low_confidence'],
    }),
  };
}

const all = () => Object.values(fixtures());

describe('applyFilters', () => {
  it('returns everything with no filters active', () => {
    expect(applyFilters(all(), NO_FILTERS).map((t) => t.id).sort()).toEqual(
      ['groceries', 'salary', 'transfer', 'amazon', 'starbucks', 'netflix'].sort(),
    );
  });

  it('returns an empty array for empty input', () => {
    expect(applyFilters([], NO_FILTERS)).toEqual([]);
  });

  it('sorts newest-first by date', () => {
    const ids = applyFilters(all(), NO_FILTERS).map((t) => t.id);
    // 2024-01-20 (netflix) → 01-15 (amazon) → 01-12 (starbucks) → 01-10 (groceries)
    // → 01-08 (transfer) → 01-05 (salary)
    expect(ids).toEqual(['netflix', 'amazon', 'starbucks', 'groceries', 'transfer', 'salary']);
  });

  describe('search', () => {
    it('matches a description substring case-insensitively', () => {
      const f: FilterState = { ...NO_FILTERS, search: 'swiggy' };
      expect(applyFilters(all(), f).map((t) => t.id)).toEqual(['groceries']);
    });

    it('empty search matches all', () => {
      expect(applyFilters(all(), { ...NO_FILTERS, search: '' }).length).toBe(all().length);
    });

    it('a search matching nothing returns empty', () => {
      expect(applyFilters(all(), { ...NO_FILTERS, search: 'zzz-no-match' })).toEqual([]);
    });
  });

  describe('category', () => {
    it('keeps only the selected category', () => {
      const f: FilterState = { ...NO_FILTERS, category: 'groceries' };
      expect(applyFilters(all(), f).map((t) => t.id)).toEqual(['groceries']);
    });

    it('an unknown category id matches nothing', () => {
      expect(applyFilters(all(), { ...NO_FILTERS, category: 'nope' })).toEqual([]);
    });
  });

  describe('type', () => {
    it('income keeps only income rows', () => {
      expect(applyFilters(all(), { ...NO_FILTERS, type: 'income' }).map((t) => t.id)).toEqual(['salary']);
    });

    it('expense keeps only spending rows', () => {
      const ids = applyFilters(all(), { ...NO_FILTERS, type: 'expense' }).map((t) => t.id).sort();
      // salary (income) and transfer (excluded) are NOT expenses
      expect(ids).toEqual(['amazon', 'groceries', 'netflix', 'starbucks'].sort());
    });

    it('transfer keeps only excluded rows', () => {
      expect(applyFilters(all(), { ...NO_FILTERS, type: 'transfer' }).map((t) => t.id)).toEqual(['transfer']);
    });

    it('an expense row is hidden by the income filter', () => {
      expect(applyFilters(all(), { ...NO_FILTERS, type: 'income' }).map((t) => t.id)).not.toContain('groceries');
    });
  });

  describe('source', () => {
    it('credit_card keeps only card rows', () => {
      expect(applyFilters(all(), { ...NO_FILTERS, source: 'credit_card' }).map((t) => t.id)).toEqual(['amazon']);
    });

    it('bank keeps only bank rows', () => {
      const ids = applyFilters(all(), { ...NO_FILTERS, source: 'bank' }).map((t) => t.id);
      expect(ids).not.toContain('amazon');
      expect(ids.length).toBe(all().length - 1);
    });
  });

  describe('anomaly', () => {
    it('keeps only active (non-dismissed) anomalies', () => {
      expect(applyFilters(all(), { ...NO_FILTERS, anomalyOnly: true }).map((t) => t.id)).toEqual(['amazon']);
    });

    it('a dismissed anomaly is hidden even with the filter on', () => {
      const ids = applyFilters(all(), { ...NO_FILTERS, anomalyOnly: true }).map((t) => t.id);
      expect(ids).not.toContain('starbucks');
    });
  });

  describe('needs-review', () => {
    it('keeps only rows carrying review reasons', () => {
      expect(applyFilters(all(), { ...NO_FILTERS, needsReviewOnly: true }).map((t) => t.id)).toEqual(['netflix']);
    });
  });

  describe('combinations', () => {
    it('filters AND together', () => {
      const f: FilterState = { ...NO_FILTERS, source: 'bank', type: 'expense' };
      const ids = applyFilters(all(), f).map((t) => t.id).sort();
      expect(ids).toEqual(['groceries', 'netflix', 'starbucks'].sort());
    });

    it('conflicting filters yield an empty result', () => {
      // No row is both income AND a credit-card source.
      const f: FilterState = { ...NO_FILTERS, type: 'income', source: 'credit_card' };
      expect(applyFilters(all(), f)).toEqual([]);
    });
  });
});

describe('activeAnomalyCount', () => {
  it('counts only active (non-dismissed) anomalies', () => {
    expect(activeAnomalyCount(all())).toBe(1); // amazon active; starbucks dismissed
  });

  it('excludes dismissed anomalies', () => {
    const onlyDismissed = [fixtures().diningBankDismissedAnomaly];
    expect(activeAnomalyCount(onlyDismissed)).toBe(0);
  });

  it('excludes non-anomalies', () => {
    expect(activeAnomalyCount([fixtures().groceriesBank])).toBe(0);
  });

  it('is zero for empty input', () => {
    expect(activeAnomalyCount([])).toBe(0);
  });
});

describe('hasFilters', () => {
  it('is false at the default state', () => {
    expect(hasFilters(NO_FILTERS)).toBe(false);
  });

  it.each([
    ['search', { ...NO_FILTERS, search: 'x' }] as const,
    ['category', { ...NO_FILTERS, category: 'dining' }] as const,
    ['type', { ...NO_FILTERS, type: 'income' }] as const,
    ['source', { ...NO_FILTERS, source: 'bank' }] as const,
    ['anomaly', { ...NO_FILTERS, anomalyOnly: true }] as const,
    ['needsReview', { ...NO_FILTERS, needsReviewOnly: true }] as const,
  ])('is true when %s is active', (_label, f) => {
    expect(hasFilters(f)).toBe(true);
  });
});

describe('isAllSelected', () => {
  it('is false when there are no filtered rows', () => {
    expect(isAllSelected([], [])).toBe(false);
    expect(isAllSelected([], ['a'])).toBe(false);
  });

  it('is true when every filtered row is selected', () => {
    const txns = all();
    expect(isAllSelected(txns, txns.map((t) => t.id))).toBe(true);
  });

  it('is false on a partial selection', () => {
    const txns = all();
    expect(isAllSelected(txns, [txns[0].id])).toBe(false);
  });

  it('is false when nothing is selected', () => {
    expect(isAllSelected(all(), [])).toBe(false);
  });
});
