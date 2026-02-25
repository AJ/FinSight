import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Budget, BudgetProgress } from '@/types';

interface BudgetStore {
  budgets: Budget[];
  currentBudget: Budget | null;
  createBudget: (budget: Budget) => void;
  updateBudgetAllocation: (categoryId: string, amount: number) => void;
  setCurrentBudget: (budgetId: string) => void;
  getCurrentBudget: () => Budget | null;
  getBudgetProgress: (categoryId: string, actualSpent: number) => BudgetProgress;
  autoDistributeBudget: (totalIncome: number, projectedSpending: Record<string, number>) => void;
}

export const useBudgetStore = create<BudgetStore>()(
  persist(
    (set, get) => ({
      budgets: [],
      currentBudget: null,

      createBudget: (budget) =>
        set((state) => ({
          budgets: [...state.budgets, budget],
          currentBudget: budget,
        })),

      updateBudgetAllocation: (categoryId, amount) =>
        set((state) => {
          if (!state.currentBudget) return state;

          const updatedAllocations = state.currentBudget.allocations.map((allocation) =>
            allocation.categoryId === categoryId
              ? { ...allocation, budgetedAmount: amount }
              : allocation
          );

          const updatedBudget = {
            ...state.currentBudget,
            allocations: updatedAllocations,
          };

          return {
            currentBudget: updatedBudget,
            budgets: state.budgets.map((b) =>
              b.id === updatedBudget.id ? updatedBudget : b
            ),
          };
        }),

      setCurrentBudget: (budgetId) =>
        set((state) => ({
          currentBudget: state.budgets.find((b) => b.id === budgetId) || null,
        })),

      getCurrentBudget: () => get().currentBudget,

      getBudgetProgress: (categoryId, actualSpent) => {
        const { currentBudget } = get();
        if (!currentBudget) {
          return {
            budgeted: 0,
            spent: actualSpent,
            remaining: 0,
            percentUsed: 0,
            status: 'on-track',
          };
        }

        const allocation = currentBudget.allocations.find(
          (a) => a.categoryId === categoryId
        );

        if (!allocation) {
          return {
            budgeted: 0,
            spent: actualSpent,
            remaining: 0,
            percentUsed: 0,
            status: 'on-track',
          };
        }

        const budgeted = allocation.budgetedAmount;
        const remaining = budgeted - actualSpent;
        const percentUsed = budgeted > 0 ? (actualSpent / budgeted) * 100 : 0;

        let status: 'on-track' | 'warning' | 'over-budget';
        if (percentUsed <= 75) {
          status = 'on-track';
        } else if (percentUsed <= 100) {
          status = 'warning';
        } else {
          status = 'over-budget';
        }

        return {
          budgeted,
          spent: actualSpent,
          remaining,
          percentUsed,
          status,
        };
      },

      autoDistributeBudget: (totalIncome, projectedSpending) =>
        set((state) => {
          if (!state.currentBudget) return state;

          const totalProjected = Object.values(projectedSpending).reduce(
            (sum, val) => sum + val,
            0
          );

          const updatedAllocations = state.currentBudget.allocations.map(
            (allocation) => {
              const projected = projectedSpending[allocation.categoryId] || 0;
              const proportion = totalProjected > 0 ? projected / totalProjected : 0;
              const budgetedAmount = Math.round(totalIncome * proportion);

              return {
                ...allocation,
                budgetedAmount,
              };
            }
          );

          const updatedBudget = {
            ...state.currentBudget,
            totalIncome,
            allocations: updatedAllocations,
          };

          return {
            currentBudget: updatedBudget,
            budgets: state.budgets.map((b) =>
              b.id === updatedBudget.id ? updatedBudget : b
            ),
          };
        }),
    }),
    {
      name: 'budget-storage',
    }
  )
);
