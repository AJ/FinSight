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
