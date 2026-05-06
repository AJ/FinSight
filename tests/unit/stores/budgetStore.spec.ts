import { describe, it, expect, beforeEach } from 'vitest';
import { useBudgetStore } from '@/lib/store/budgetStore';
import { makeTransaction, makeCategory } from '@tests/unit/factories';
import { CategoryType } from '@/types';

describe('useBudgetStore (redesigned)', () => {
  beforeEach(() => {
    const { periods } = useBudgetStore.getState();
    Object.keys(periods).forEach(month => {
      useBudgetStore.getState().deletePeriod(month);
    });
  });

  describe('getPeriod / savePeriod', () => {
    it('returns null for non-existent period', () => {
      expect(useBudgetStore.getState().getPeriod('2026-04')).toBeNull();
    });

    it('saves and retrieves a period', () => {
      const store = useBudgetStore.getState();
      store.setIncome('2026-04', 50000);
      store.setAllocation('2026-04', 'groceries', 15000);
      store.setAllocation('2026-04', 'dining', 8000);
      store.savePeriod('2026-04');

      const period = useBudgetStore.getState().getPeriod('2026-04');
      expect(period).not.toBeNull();
      expect(period!.income).toBe(50000);
      expect(period!.allocations).toHaveLength(2);
      expect(period!.allocations.find(a => a.categoryId === 'groceries')!.amount).toBe(15000);
    });

    it('savePeriod creates period if it does not exist', () => {
      useBudgetStore.getState().savePeriod('2026-05');
      const period = useBudgetStore.getState().getPeriod('2026-05');
      expect(period).not.toBeNull();
      expect(period!.income).toBeNull();
      expect(period!.allocations).toHaveLength(0);
    });
  });

  describe('setAllocation', () => {
    it('adds new allocation', () => {
      useBudgetStore.getState().setAllocation('2026-04', 'groceries', 10000);
      useBudgetStore.getState().savePeriod('2026-04');

      const period = useBudgetStore.getState().getPeriod('2026-04')!;
      expect(period.allocations).toHaveLength(1);
      expect(period.allocations[0].categoryId).toBe('groceries');
      expect(period.allocations[0].amount).toBe(10000);
    });

    it('updates existing allocation', () => {
      const store = useBudgetStore.getState();
      store.setAllocation('2026-04', 'groceries', 10000);
      store.savePeriod('2026-04');
      store.setAllocation('2026-04', 'groceries', 15000);
      store.savePeriod('2026-04');

      const period = useBudgetStore.getState().getPeriod('2026-04')!;
      expect(period.allocations).toHaveLength(1);
      expect(period.allocations[0].amount).toBe(15000);
    });
  });

  describe('removeAllocation', () => {
    it('removes an allocation', () => {
      const store = useBudgetStore.getState();
      store.setAllocation('2026-04', 'groceries', 10000);
      store.setAllocation('2026-04', 'dining', 5000);
      store.savePeriod('2026-04');
      store.removeAllocation('2026-04', 'groceries');
      store.savePeriod('2026-04');

      const period = useBudgetStore.getState().getPeriod('2026-04')!;
      expect(period.allocations).toHaveLength(1);
      expect(period.allocations[0].categoryId).toBe('dining');
    });
  });

  describe('carryForward', () => {
    it('copies allocations and income to next month', () => {
      const store = useBudgetStore.getState();
      store.setIncome('2026-04', 50000);
      store.setAllocation('2026-04', 'groceries', 15000);
      store.setAllocation('2026-04', 'dining', 8000);
      store.hideCategory('2026-04', 'travel');
      store.savePeriod('2026-04');

      store.carryForward('2026-04', '2026-05');

      const may = useBudgetStore.getState().getPeriod('2026-05');
      expect(may).not.toBeNull();
      expect(may!.income).toBe(50000);
      expect(may!.allocations).toHaveLength(2);
      expect(may!.hiddenCategories).toEqual(['travel']);
    });
  });

  describe('computeProgress', () => {
    it('computes progress with no transactions', () => {
      const store = useBudgetStore.getState();
      store.setAllocation('2026-04', 'groceries', 15000);
      store.setAllocation('2026-04', 'dining', 8000);
      store.savePeriod('2026-04');

      const progress = store.computeProgress('2026-04', []);
      expect(progress).toHaveLength(2);
      expect(progress.find(p => p.categoryId === 'groceries')!.status).toBe('on-track');
      expect(progress.find(p => p.categoryId === 'groceries')!.spent).toBe(0);
    });

    it('marks category as warning at 80%+', () => {
      const store = useBudgetStore.getState();
      store.setAllocation('2026-04', 'groceries', 10000);
      store.savePeriod('2026-04');

      const txns = [
        makeTransaction({ category: makeCategory('groceries'), amount: 8500, date: new Date('2026-04-10') }),
      ];

      const progress = store.computeProgress('2026-04', txns);
      const groceries = progress.find(p => p.categoryId === 'groceries')!;
      expect(groceries.percentUsed).toBe(85);
      expect(groceries.status).toBe('warning');
    });

    it('marks category as over-budget at 100%+', () => {
      const store = useBudgetStore.getState();
      store.setAllocation('2026-04', 'groceries', 10000);
      store.savePeriod('2026-04');

      const txns = [
        makeTransaction({ category: makeCategory('groceries'), amount: 12000, date: new Date('2026-04-10') }),
      ];

      const progress = store.computeProgress('2026-04', txns);
      const groceries = progress.find(p => p.categoryId === 'groceries')!;
      expect(groceries.status).toBe('over-budget');
      expect(groceries.remaining).toBe(-2000);
    });

    it('marks unbudgeted spending as not-set', () => {
      const store = useBudgetStore.getState();
      store.savePeriod('2026-04');

      const txns = [
        makeTransaction({ category: makeCategory('groceries'), amount: 500, date: new Date('2026-04-10') }),
      ];

      const progress = store.computeProgress('2026-04', txns);
      const groceries = progress.find(p => p.categoryId === 'groceries')!;
      expect(groceries.status).toBe('not-set');
      expect(groceries.budgeted).toBe(0);
    });
  });

  describe('category visibility', () => {
    it('hideCategory adds to hiddenCategories', () => {
      useBudgetStore.getState().savePeriod('2026-04');
      useBudgetStore.getState().hideCategory('2026-04', 'travel');
      useBudgetStore.getState().savePeriod('2026-04');

      const period = useBudgetStore.getState().getPeriod('2026-04')!;
      expect(period.hiddenCategories).toContain('travel');
    });

    it('addCategory removes from hiddenCategories', () => {
      const store = useBudgetStore.getState();
      store.savePeriod('2026-04');
      store.hideCategory('2026-04', 'travel');
      store.savePeriod('2026-04');

      const hidden = useBudgetStore.getState().getPeriod('2026-04')!;
      expect(hidden.hiddenCategories).toContain('travel');

      store.addCategory('2026-04', 'travel');
      store.savePeriod('2026-04');

      const restored = useBudgetStore.getState().getPeriod('2026-04')!;
      expect(restored.hiddenCategories).not.toContain('travel');
    });
  });

  describe('notifications', () => {
    it('dismissNotification stores dismissed month', () => {
      useBudgetStore.getState().dismissNotification('noBudget', '2026-04');
      expect(useBudgetStore.getState().notifications.dismissedNoBudget).toBe('2026-04');
    });
  });

  describe('autoDistribute', () => {
    it('distributes income proportionally based on projected spending', () => {
      const store = useBudgetStore.getState();
      store.setIncome('2026-04', 30000);
      store.savePeriod('2026-04');

      const projected = { groceries: 10000, dining: 5000 };
      store.autoDistribute('2026-04', projected);
      store.savePeriod('2026-04');

      const period = useBudgetStore.getState().getPeriod('2026-04')!;
      const groceriesAlloc = period.allocations.find(a => a.categoryId === 'groceries');
      const diningAlloc = period.allocations.find(a => a.categoryId === 'dining');

      expect(groceriesAlloc!.amount).toBe(20000);
      expect(diningAlloc!.amount).toBe(10000);
    });
  });

  describe('additional coverage', () => {
    it('autoDistribute with zero income does nothing', () => {
      const store = useBudgetStore.getState();
      store.setIncome('2026-04', 0);
      store.setAllocation('2026-04', 'groceries', 5000);
      store.savePeriod('2026-04');

      store.autoDistribute('2026-04', { groceries: 10000, dining: 5000 });
      store.savePeriod('2026-04');

      const period = useBudgetStore.getState().getPeriod('2026-04')!;
      // Original allocation unchanged — autoDistribute returned early
      expect(period.allocations).toHaveLength(1);
      expect(period.allocations[0].categoryId).toBe('groceries');
      expect(period.allocations[0].amount).toBe(5000);
    });

    it('autoDistribute with zero total projected does nothing', () => {
      const store = useBudgetStore.getState();
      store.setIncome('2026-04', 50000);
      store.setAllocation('2026-04', 'groceries', 5000);
      store.savePeriod('2026-04');

      store.autoDistribute('2026-04', {});
      store.savePeriod('2026-04');

      const period = useBudgetStore.getState().getPeriod('2026-04')!;
      expect(period.allocations).toHaveLength(1);
      expect(period.allocations[0].amount).toBe(5000);
    });

    it('autoDistribute rounds allocations to integers', () => {
      const store = useBudgetStore.getState();
      store.setIncome('2026-04', 10000);
      store.savePeriod('2026-04');

      store.autoDistribute('2026-04', { groceries: 3333, dining: 6667 });
      store.savePeriod('2026-04');

      const period = useBudgetStore.getState().getPeriod('2026-04')!;
      const groceriesAlloc = period.allocations.find(a => a.categoryId === 'groceries')!;
      const diningAlloc = period.allocations.find(a => a.categoryId === 'dining')!;

      // groceries: 10000 * (3333/10000) = 3333
      // dining: 10000 * (6667/10000) = 6667
      expect(groceriesAlloc.amount).toBe(Math.round(10000 * (3333 / 10000)));
      expect(diningAlloc.amount).toBe(Math.round(10000 * (6667 / 10000)));
      expect(Number.isInteger(groceriesAlloc.amount)).toBe(true);
      expect(Number.isInteger(diningAlloc.amount)).toBe(true);
    });

    it('computeProgress with mixed budgeted and unbudgeted', () => {
      const store = useBudgetStore.getState();
      store.setAllocation('2026-04', 'groceries', 10000);
      store.savePeriod('2026-04');

      const txns = [
        makeTransaction({ category: makeCategory('groceries'), amount: 5000, date: new Date('2026-04-10') }),
        makeTransaction({ category: makeCategory('dining'), amount: 3000, date: new Date('2026-04-10') }),
      ];

      const progress = store.computeProgress('2026-04', txns);
      const groceries = progress.find(p => p.categoryId === 'groceries')!;
      const dining = progress.find(p => p.categoryId === 'dining')!;

      expect(groceries.status).toBe('on-track');
      expect(dining.status).toBe('not-set');
    });

    it('computeProgress with zero budget and zero spending returns empty array', () => {
      const store = useBudgetStore.getState();
      store.savePeriod('2026-04');

      const progress = store.computeProgress('2026-04', []);
      expect(progress).toEqual([]);
    });

    it('computeProgress only counts expense transactions', () => {
      const store = useBudgetStore.getState();
      store.setAllocation('2026-04', 'groceries', 10000);
      store.savePeriod('2026-04');

      const txns = [
        makeTransaction({ category: makeCategory('salary', CategoryType.Income), amount: 4000, date: new Date('2026-04-10') }),
        makeTransaction({ category: makeCategory('groceries'), amount: 3000, date: new Date('2026-04-10') }),
      ];

      const progress = store.computeProgress('2026-04', txns);
      const groceries = progress.find(p => p.categoryId === 'groceries')!;

      expect(groceries.spent).toBe(3000);
    });

    it('computeProgress only counts transactions for the target month', () => {
      const store = useBudgetStore.getState();
      store.setAllocation('2026-04', 'groceries', 10000);
      store.savePeriod('2026-04');

      const txns = [
        makeTransaction({ category: makeCategory('groceries'), amount: 5000, date: new Date('2026-03-15') }),
        makeTransaction({ category: makeCategory('groceries'), amount: 2000, date: new Date('2026-04-10') }),
      ];

      const progress = store.computeProgress('2026-04', txns);
      const groceries = progress.find(p => p.categoryId === 'groceries')!;

      expect(groceries.spent).toBe(2000);
    });

    it('setIncome creates working state without persisting', () => {
      const store = useBudgetStore.getState();
      store.setIncome('2026-06', 50000);

      // Not saved yet — getPeriod reads from periods, not working state
      expect(useBudgetStore.getState().getPeriod('2026-06')).toBeNull();
    });

    it('removeAllocation on non-existent allocation is a no-op', () => {
      expect(() => {
        useBudgetStore.getState().removeAllocation('2026-07', 'nonexistent');
      }).not.toThrow();
    });

    it('carryForward with non-existent source month', () => {
      const store = useBudgetStore.getState();
      store.carryForward('2026-01', '2026-02');

      expect(useBudgetStore.getState().getPeriod('2026-02')).toBeNull();
    });

    it('deletePeriod clears working state', () => {
      const store = useBudgetStore.getState();
      store.setIncome('2026-04', 50000);
      store.setAllocation('2026-04', 'groceries', 10000);
      store.savePeriod('2026-04');

      store.deletePeriod('2026-04');

      expect(useBudgetStore.getState().getPeriod('2026-04')).toBeNull();
    });

    it('addCategory removes from hidden without duplicating', () => {
      const store = useBudgetStore.getState();
      store.savePeriod('2026-04');
      store.hideCategory('2026-04', 'travel');
      store.hideCategory('2026-04', 'dining');
      store.savePeriod('2026-04');

      let period = useBudgetStore.getState().getPeriod('2026-04')!;
      expect(period.hiddenCategories).toEqual(expect.arrayContaining(['travel', 'dining']));

      store.addCategory('2026-04', 'travel');
      store.savePeriod('2026-04');

      period = useBudgetStore.getState().getPeriod('2026-04')!;
      expect(period.hiddenCategories).not.toContain('travel');
      expect(period.hiddenCategories).toContain('dining');
      expect(period.hiddenCategories).toHaveLength(1);
    });

    it('hideCategory does not duplicate', () => {
      const store = useBudgetStore.getState();
      store.savePeriod('2026-04');
      store.hideCategory('2026-04', 'travel');
      store.savePeriod('2026-04');

      let period = useBudgetStore.getState().getPeriod('2026-04')!;
      expect(period.hiddenCategories).toHaveLength(1);

      store.hideCategory('2026-04', 'travel');
      store.savePeriod('2026-04');

      period = useBudgetStore.getState().getPeriod('2026-04')!;
      expect(period.hiddenCategories).toHaveLength(1);
      expect(period.hiddenCategories).toContain('travel');
    });

    it('getNotification returns null when budget exists for current month', () => {
      const store = useBudgetStore.getState();
      const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
      store.setIncome(currentMonth, 50000);
      store.savePeriod(currentMonth);

      const notification = useBudgetStore.getState().getNotification();
      // With a budget for the current month, noBudget should not fire.
      // eom notification could still fire if day >= 28 and no next-month budget,
      // so check that it's not a noBudget for the current month.
      if (notification) {
        expect(notification).not.toEqual({ type: 'noBudget', month: currentMonth });
      }
    });
  });
});
