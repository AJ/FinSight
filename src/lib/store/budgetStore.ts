import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { BudgetPeriod, BudgetAllocation, BudgetProgress, Transaction } from '@/types';
import { getApplicableNotification } from '@/lib/budget/notificationLogic';
import { computeBudgetProgress } from '@/lib/budget/progressCalculation';
import { format } from 'date-fns';

interface BudgetStore {
  periods: Record<string, BudgetPeriod>;
  notifications: {
    dismissedNoBudget: string | null;
    dismissedEOM: string | null;
  };

  getPeriod: (month: string) => BudgetPeriod | null;
  setIncome: (month: string, amount: number) => void;
  setAllocation: (month: string, categoryId: string, amount: number) => void;
  removeAllocation: (month: string, categoryId: string) => void;
  addCategory: (month: string, categoryId: string) => void;
  hideCategory: (month: string, categoryId: string) => void;
  savePeriod: (month: string) => void;
  deletePeriod: (month: string) => void;
  carryForward: (fromMonth: string, toMonth: string) => void;
  autoDistribute: (month: string, projectedSpending: Record<string, number>) => void;
  dismissNotification: (type: 'noBudget' | 'eom', month: string) => void;
  getNotification: () => { type: 'noBudget' | 'eom'; month: string } | null;
  computeProgress: (month: string, transactions: Transaction[]) => BudgetProgress[];
}

const workingState: Record<string, Partial<BudgetPeriod>> = {};

function getOrCreateWorking(month: string, periods: Record<string, BudgetPeriod>): Partial<BudgetPeriod> & { month: string } {
  const existing = periods[month];
  const working = workingState[month];
  return {
    month,
    income: working?.income ?? existing?.income ?? null,
    allocations: working?.allocations ?? existing?.allocations ?? [],
    hiddenCategories: working?.hiddenCategories ?? existing?.hiddenCategories ?? [],
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: existing?.updatedAt ?? new Date().toISOString(),
  };
}

export const useBudgetStore = create<BudgetStore>()(
  persist(
    (set, get) => ({
      periods: {},
      notifications: {
        dismissedNoBudget: null,
        dismissedEOM: null,
      },

      getPeriod: (month) => get().periods[month] ?? null,

      setIncome: (month, amount) => {
        const working = getOrCreateWorking(month, get().periods);
        working.income = amount;
        workingState[month] = working;
      },

      setAllocation: (month, categoryId, amount) => {
        const working = getOrCreateWorking(month, get().periods);
        const allocations = [...(working.allocations ?? [])];
        const idx = allocations.findIndex(a => a.categoryId === categoryId);
        if (idx >= 0) {
          allocations[idx] = { categoryId, amount };
        } else {
          allocations.push({ categoryId, amount });
        }
        working.allocations = allocations;
        workingState[month] = working;
      },

      removeAllocation: (month, categoryId) => {
        const working = getOrCreateWorking(month, get().periods);
        working.allocations = (working.allocations ?? []).filter(a => a.categoryId !== categoryId);
        workingState[month] = working;
      },

      savePeriod: (month) => {
        const working = getOrCreateWorking(month, get().periods);
        const period: BudgetPeriod = {
          month,
          income: working.income ?? null,
          allocations: working.allocations ?? [],
          hiddenCategories: working.hiddenCategories ?? [],
          createdAt: working.createdAt ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        set((state) => ({
          periods: { ...state.periods, [month]: period },
        }));
        delete workingState[month];
      },

      deletePeriod: (month) => {
        set((state) => {
          const periods = { ...state.periods };
          delete periods[month];
          return { periods };
        });
        delete workingState[month];
      },

      addCategory: (month, categoryId) => {
        const working = getOrCreateWorking(month, get().periods);
        working.hiddenCategories = (working.hiddenCategories ?? []).filter(id => id !== categoryId);
        workingState[month] = working;
      },

      hideCategory: (month, categoryId) => {
        const working = getOrCreateWorking(month, get().periods);
        const hidden = working.hiddenCategories ?? [];
        if (!hidden.includes(categoryId)) {
          working.hiddenCategories = [...hidden, categoryId];
        }
        workingState[month] = working;
      },

      carryForward: (fromMonth, toMonth) => {
        const source = get().periods[fromMonth];
        if (!source) return;

        const target: BudgetPeriod = {
          month: toMonth,
          income: source.income,
          allocations: source.allocations.map(a => ({ ...a })),
          hiddenCategories: [...source.hiddenCategories],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        set((state) => ({
          periods: { ...state.periods, [toMonth]: target },
        }));
        delete workingState[toMonth];
      },

      autoDistribute: (month, projectedSpending) => {
        const working = getOrCreateWorking(month, get().periods);
        const income = working.income ?? 0;
        const totalProjected = Object.values(projectedSpending).reduce((s, v) => s + v, 0);

        if (totalProjected === 0 || income === 0) return;

        const allocations: BudgetAllocation[] = Object.entries(projectedSpending).map(
          ([categoryId, projected]) => ({
            categoryId,
            amount: Math.round(income * (projected / totalProjected)),
          })
        );

        working.allocations = allocations;
        workingState[month] = working;
      },

      dismissNotification: (type, month) => {
        set((state) => ({
          notifications: {
            ...state.notifications,
            ...(type === 'noBudget'
              ? { dismissedNoBudget: month }
              : { dismissedEOM: month }),
          },
        }));
      },

      getNotification: () => {
        const { periods, notifications } = get();
        const today = new Date();
        const currentMonth = format(today, 'yyyy-MM');
        const nextMonth = format(new Date(today.getFullYear(), today.getMonth() + 1, 1), 'yyyy-MM');

        return getApplicableNotification({
          today,
          currentMonth,
          nextMonth,
          hasCurrentMonthBudget: currentMonth in periods,
          hasNextMonthBudget: nextMonth in periods,
          dismissedNoBudget: notifications.dismissedNoBudget,
          dismissedEOM: notifications.dismissedEOM,
        });
      },

      computeProgress: (month, transactions) => {
        const period = get().periods[month];
        return computeBudgetProgress(period, transactions, month);
      },
    }),
    {
      name: 'budget-storage',
    }
  )
);
