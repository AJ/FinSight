import { Transaction } from '@/types';
import { startOfMonth, subMonths, isWithinInterval, format } from 'date-fns';

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export function forecastCategorySpending(
  transactions: Transaction[],
  categoryId: string,
  lookbackMonths: number = 3
): number {
  const now = new Date();
  const startDate = startOfMonth(subMonths(now, lookbackMonths));

  const relevantTransactions = transactions.filter((t) => {
    return (
      t.category.id === categoryId &&
      t.isExpense &&
      isWithinInterval(t.date, { start: startDate, end: now })
    );
  });

  if (relevantTransactions.length === 0) {
    return 0;
  }

  // Group by month, sum per month
  const monthlySums: Record<string, number> = {};
  for (const t of relevantTransactions) {
    const monthKey = format(t.date, 'yyyy-MM');
    monthlySums[monthKey] = (monthlySums[monthKey] || 0) + Math.abs(t.amount);
  }

  return median(Object.values(monthlySums));
}

export function forecastAllCategories(
  transactions: Transaction[],
  categoryIds: string[]
): Record<string, number> {
  const forecast: Record<string, number> = {};

  for (const categoryId of categoryIds) {
    forecast[categoryId] = forecastCategorySpending(transactions, categoryId);
  }

  return forecast;
}

export function calculateMedianMonthlyIncome(
  transactions: Transaction[],
  lookbackMonths: number = 3
): number {
  const now = new Date();
  const startDate = startOfMonth(subMonths(now, lookbackMonths));

  const incomeTransactions = transactions.filter((t) => {
    return (
      t.isIncome &&
      isWithinInterval(t.date, { start: startDate, end: now })
    );
  });

  if (incomeTransactions.length === 0) {
    return 0;
  }

  // Group by month, sum per month
  const monthlySums: Record<string, number> = {};
  for (const t of incomeTransactions) {
    const monthKey = format(t.date, 'yyyy-MM');
    monthlySums[monthKey] = (monthlySums[monthKey] || 0) + t.amount;
  }

  return median(Object.values(monthlySums));
}

/** @deprecated Use calculateMedianMonthlyIncome instead */
export function calculateAverageMonthlyIncome(
  transactions: Transaction[],
  lookbackMonths: number = 3
): number {
  return calculateMedianMonthlyIncome(transactions, lookbackMonths);
}
