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

export interface SparklineSVGPoints {
  polyline: string;
  dots: Array<{ x: number; y: number }>;
}

export function computeSparklineSVGPoints(
  data: SparklinePoint[],
  width: number = 100,
  height: number = 28,
  paddingX: number = 5,
  paddingTop: number = 6,
  paddingBottom: number = 6,
): SparklineSVGPoints {
  if (data.length < 2) {
    return { polyline: '', dots: [] };
  }

  const max = Math.max(...data.map((p) => p.amount), 1);
  const drawWidth = width - paddingX * 2;
  const drawHeight = height - paddingTop - paddingBottom;

  const dots = data.map((p, i) => ({
    x: paddingX + (i / (data.length - 1)) * drawWidth,
    y: height - paddingBottom - (p.amount / max) * drawHeight,
  }));

  const polyline = dots.map((d) => `${d.x},${d.y}`).join(' ');

  return { polyline, dots };
}

export function getSparklineColor(percentUsed: number): string {
  if (percentUsed >= 100) return '#ef4444';
  if (percentUsed >= 80) return '#eab308';
  return '#22c55e';
}
