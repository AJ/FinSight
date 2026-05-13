import { BudgetPeriod } from '@/types';

export interface CarryForwardInput {
  month: string;
  periods: Record<string, BudgetPeriod>;
}

export interface CarryForwardResult {
  income: number;
  allocations: Record<string, number>;
  hidden: string[];
}

export function findCarryForwardState(input: CarryForwardInput): CarryForwardResult {
  const { month, periods } = input;

  const existing = periods[month];
  if (existing) {
    return {
      income: existing.income ?? 0,
      allocations: Object.fromEntries(existing.allocations.map(a => [a.categoryId, a.amount])),
      hidden: [...existing.hiddenCategories],
    };
  }

  const previousMonths = Object.keys(periods)
    .filter(m => m < month)
    .sort()
    .reverse();

  for (const prevMonth of previousMonths) {
    const prevPeriod = periods[prevMonth];
    if (prevPeriod) {
      return {
        income: prevPeriod.income ?? 0,
        allocations: Object.fromEntries(prevPeriod.allocations.map(a => [a.categoryId, a.amount])),
        hidden: [...prevPeriod.hiddenCategories],
      };
    }
  }

  return { income: 0, allocations: {}, hidden: [] };
}

export interface DirtyCheckInput {
  localIncome: number;
  localAllocations: Record<string, number>;
  localHidden: string[];
  period: BudgetPeriod | null;
}

export function isBudgetDirty(input: DirtyCheckInput): boolean {
  const { localIncome, localAllocations, localHidden, period } = input;
  const savedAllocMap = Object.fromEntries(
    (period?.allocations ?? []).map(a => [a.categoryId, a.amount]),
  );
  return localIncome !== (period?.income ?? 0)
    || JSON.stringify(localAllocations) !== JSON.stringify(savedAllocMap)
    || JSON.stringify(localHidden) !== JSON.stringify(period?.hiddenCategories ?? []);
}

export interface SaveValidationInput {
  isDirty: boolean;
  isOverAllocated: boolean;
  income: number;
  hasCategories: boolean;
}

export function getSaveDisabledReason(input: SaveValidationInput): string {
  const { isDirty, isOverAllocated, income, hasCategories } = input;
  if (!isDirty) return 'No changes to save';
  if (isOverAllocated) return 'Over-allocated — reduce category amounts to fit within budget';
  if (income === 0) return 'Set a total budget first';
  if (!hasCategories) return 'Add at least one category';
  return '';
}
