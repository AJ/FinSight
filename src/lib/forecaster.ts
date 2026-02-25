import { Transaction } from '@/types';
import { startOfMonth, subMonths, isWithinInterval } from 'date-fns';

export function forecastCategorySpending(
  transactions: Transaction[],
  categoryId: string,
  lookbackMonths: number = 3
): number {
  const now = new Date();
  const startDate = startOfMonth(subMonths(now, lookbackMonths));

  const relevantTransactions = transactions.filter((t) => {
    return (
      t.category === categoryId &&
      t.type === 'expense' &&
      isWithinInterval(t.date, { start: startDate, end: now })
    );
  });

  if (relevantTransactions.length === 0) {
    return 0;
  }

  const totalSpent = relevantTransactions.reduce(
    (sum, t) => sum + Math.abs(t.amount),
    0
  );

  return totalSpent / lookbackMonths;
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

export function calculateAverageMonthlyIncome(
  transactions: Transaction[],
  lookbackMonths: number = 3
): number {
  const now = new Date();
  const startDate = startOfMonth(subMonths(now, lookbackMonths));

  const incomeTransactions = transactions.filter((t) => {
    return (
      t.type === 'income' &&
      isWithinInterval(t.date, { start: startDate, end: now })
    );
  });

  if (incomeTransactions.length === 0) {
    return 0;
  }

  const totalIncome = incomeTransactions.reduce(
    (sum, t) => sum + t.amount,
    0
  );

  return totalIncome / lookbackMonths;
}
