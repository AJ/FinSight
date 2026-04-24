import { describe, it, expect, beforeEach } from 'vitest';
import { useBudgetStore } from '@/lib/store/budgetStore';
import { Budget } from '@/types';

function makeBudget(overrides: Partial<Budget> = {}): Budget {
  return {
    id: 'budget-1',
    label: 'January 2024',
    totalIncome: 50000,
    allocations: [
      { categoryId: 'dining', budgetedAmount: 10000 },
      { categoryId: 'groceries', budgetedAmount: 15000 },
    ],
    ...overrides,
  } as Budget;
}

describe('useBudgetStore', () => {
  beforeEach(() => {
    // Reset store state by creating a fresh budget and clearing
    const state = useBudgetStore.getState();
    // Set a known budget state
    state.createBudget(makeBudget({ id: `fresh-${Date.now()}` }));
  });

  it('createBudget stores a budget', () => {
    const budget = makeBudget({ id: `test-${Date.now()}` });
    useBudgetStore.getState().createBudget(budget);
    const current = useBudgetStore.getState().getCurrentBudget();
    expect(current).toBeDefined();
    expect(current!.totalIncome).toBe(50000);
    expect(current!.allocations.length).toBeGreaterThanOrEqual(2);
  });

  it('getBudgetProgress on-track', () => {
    const budget = makeBudget({ id: `prog1-${Date.now()}` });
    useBudgetStore.getState().createBudget(budget);
    const progress = useBudgetStore.getState().getBudgetProgress('dining', 5000);
    expect(progress.percentUsed).toBe(50);
    expect(progress.status).toBe('on-track');
  });

  it('getBudgetProgress warning', () => {
    const budget = makeBudget({ id: `prog2-${Date.now()}` });
    useBudgetStore.getState().createBudget(budget);
    const progress = useBudgetStore.getState().getBudgetProgress('dining', 8000);
    expect(progress.percentUsed).toBe(80);
    expect(progress.status).toBe('warning');
  });

  it('getBudgetProgress over-budget', () => {
    const budget = makeBudget({ id: `prog3-${Date.now()}` });
    useBudgetStore.getState().createBudget(budget);
    const progress = useBudgetStore.getState().getBudgetProgress('dining', 12000);
    expect(progress.percentUsed).toBe(120);
    expect(progress.status).toBe('over-budget');
  });
});
