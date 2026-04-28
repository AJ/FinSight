import { Transaction } from '@/types';
import { format, subMonths, startOfMonth } from 'date-fns';

export interface SparklinePoint {
  month: string;
  amount: number;
}

export function computeSparklineData(
  transactions: Transaction[],
  categoryId: string,
  months: number = 5,
  referenceDate: Date = new Date()
): SparklinePoint[] {
  const points: SparklinePoint[] = [];

  for (let i = months - 1; i >= 0; i--) {
    const targetMonth = format(subMonths(startOfMonth(referenceDate), i), 'yyyy-MM');
    const spent = transactions
      .filter(t => t.category.id === categoryId && t.isExpense && format(t.date, 'yyyy-MM') === targetMonth)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);

    points.push({ month: targetMonth, amount: spent });
  }

  return points;
}
