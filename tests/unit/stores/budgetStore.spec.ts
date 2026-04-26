import { describe, it, expect, beforeEach } from 'vitest';
import { useBudgetStore } from '@/lib/store/budgetStore';

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
        { category: { id: 'groceries' }, amount: 8500, isExpense: true, date: new Date('2026-04-10') },
      ] as any[];

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
        { category: { id: 'groceries' }, amount: 12000, isExpense: true, date: new Date('2026-04-10') },
      ] as any[];

      const progress = store.computeProgress('2026-04', txns);
      const groceries = progress.find(p => p.categoryId === 'groceries')!;
      expect(groceries.status).toBe('over-budget');
      expect(groceries.remaining).toBe(-2000);
    });

    it('marks unbudgeted spending as not-set', () => {
      const store = useBudgetStore.getState();
      store.savePeriod('2026-04');

      const txns = [
        { category: { id: 'groceries' }, amount: 500, isExpense: true, date: new Date('2026-04-10') },
      ] as any[];

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
});
