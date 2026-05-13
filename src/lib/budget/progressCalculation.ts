import { format } from 'date-fns';

export interface AllocationLike {
  categoryId: string;
  amount: number;
}

export interface PeriodLike {
  allocations: AllocationLike[];
}

export interface TransactionLike {
  isExpense: boolean;
  date: Date;
  amount: number;
  category: { id: string };
}

export interface ProgressEntry {
  categoryId: string;
  budgeted: number;
  spent: number;
  remaining: number;
  percentUsed: number;
  status: 'on-track' | 'warning' | 'over-budget' | 'not-set';
}

export function aggregateSpendingByCategory(
  transactions: TransactionLike[],
  month: string,
): Record<string, number> {
  const spending: Record<string, number> = {};
  for (const t of transactions) {
    if (!t.isExpense) continue;
    const txnMonth = format(t.date, 'yyyy-MM');
    if (txnMonth !== month) continue;
    spending[t.category.id] = (spending[t.category.id] || 0) + Math.abs(t.amount);
  }
  return spending;
}

export function classifyBudgetStatus(
  budgeted: number,
  spent: number,
  percentUsed: number,
): ProgressEntry['status'] {
  if (budgeted === 0 && spent > 0) return 'not-set';
  if (percentUsed >= 100) return 'over-budget';
  if (percentUsed >= 80) return 'warning';
  return 'on-track';
}

export function computeBudgetProgress(
  period: PeriodLike | null,
  transactions: TransactionLike[],
  month: string,
): ProgressEntry[] {
  const allocations = period?.allocations ?? [];
  const allocMap = new Map(allocations.map(a => [a.categoryId, a]));
  const allocatedIds = new Set(allocMap.keys());
  const spending = aggregateSpendingByCategory(transactions, month);

  const allCategoryIds = new Set([...allocatedIds, ...Object.keys(spending)]);
  const progress: ProgressEntry[] = [];

  for (const categoryId of allCategoryIds) {
    const budgeted = allocMap.get(categoryId)?.amount ?? 0;
    const spent = spending[categoryId] ?? 0;
    const remaining = budgeted - spent;
    const percentUsed = budgeted > 0 ? Math.round((spent / budgeted) * 100) : 0;
    const status = classifyBudgetStatus(budgeted, spent, percentUsed);

    progress.push({ categoryId, budgeted, spent, remaining, percentUsed, status });
  }

  return progress;
}
