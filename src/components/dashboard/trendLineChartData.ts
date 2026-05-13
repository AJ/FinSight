import {
  format,
  startOfMonth,
  startOfWeek,
  endOfWeek,
  differenceInWeeks,
  addWeeks,
} from 'date-fns';

export interface TrendTransactionLike {
  date: Date;
  amount: number;
  category?: { isIncome?: boolean; isExpense?: boolean } | null;
}

export interface TrendPeriod {
  start: Date;
  end: Date;
  label: string;
}

export interface TrendData {
  labels: string[];
  incomeByPeriod: number[];
  expensesByPeriod: number[];
  isWeekly: boolean;
}

export function normalizeTransactionDates(
  transactions: TrendTransactionLike[],
): Array<TrendTransactionLike & { dateObj: Date }> {
  return transactions
    .map((t) => ({
      ...t,
      dateObj: t.date,
    }))
    .filter((t) => !isNaN(t.dateObj.getTime()));
}

export function shouldUseWeeklyPeriods(firstDate: Date, lastDate: Date): boolean {
  return differenceInWeeks(lastDate, firstDate) + 1 <= 7;
}

export function buildWeeklyPeriods(firstDate: Date, lastDate: Date): TrendPeriod[] {
  const periods: TrendPeriod[] = [];
  let current = startOfWeek(firstDate, { weekStartsOn: 1 });
  const end = startOfWeek(lastDate, { weekStartsOn: 1 });

  while (current <= end) {
    const weekEnd = endOfWeek(current, { weekStartsOn: 1 });
    periods.push({
      start: current,
      end: weekEnd,
      label: format(current, 'MMM d'),
    });
    current = addWeeks(current, 1);
  }

  return periods;
}

export function buildMonthlyPeriods(
  firstDate: Date,
  lastDate: Date,
  maxMonths: number = 12,
): TrendPeriod[] {
  const firstMonth = startOfMonth(firstDate);
  const lastMonth = startOfMonth(lastDate);

  const months: TrendPeriod[] = [];
  let current = firstMonth;
  while (current <= lastMonth) {
    const monthEnd = new Date(
      current.getFullYear(),
      current.getMonth() + 1,
      0,
      23,
      59,
      59,
    );
    months.push({
      start: new Date(current),
      end: monthEnd,
      label: format(current, 'MMM yyyy'),
    });
    current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
  }

  if (maxMonths <= 0) return [];
  return months.length > maxMonths ? months.slice(-maxMonths) : months;
}

export function aggregateByPeriod(
  transactions: Array<{ dateObj: Date; amount: number; category?: { isIncome?: boolean; isExpense?: boolean } | null }>,
  periods: TrendPeriod[],
): { incomeByPeriod: number[]; expensesByPeriod: number[] } {
  const incomeByPeriod: number[] = [];
  const expensesByPeriod: number[] = [];

  for (const period of periods) {
    const periodTxns = transactions.filter(
      (t) => t.dateObj >= period.start && t.dateObj <= period.end,
    );

    const income = periodTxns
      .filter((t) => t.category?.isIncome)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);

    const expenses = periodTxns
      .filter((t) => t.category?.isExpense)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);

    incomeByPeriod.push(income);
    expensesByPeriod.push(expenses);
  }

  return { incomeByPeriod, expensesByPeriod };
}

export function buildTrendData(transactions: TrendTransactionLike[]): TrendData {
  if (transactions.length === 0) {
    return { labels: [], incomeByPeriod: [], expensesByPeriod: [], isWeekly: false };
  }

  const normalized = normalizeTransactionDates(transactions);
  if (normalized.length === 0) {
    return { labels: [], incomeByPeriod: [], expensesByPeriod: [], isWeekly: false };
  }

  normalized.sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());

  const firstDate = normalized[0].dateObj;
  const lastDate = normalized[normalized.length - 1].dateObj;
  const isWeekly = shouldUseWeeklyPeriods(firstDate, lastDate);

  const periods = isWeekly
    ? buildWeeklyPeriods(firstDate, lastDate)
    : buildMonthlyPeriods(firstDate, lastDate);

  const { incomeByPeriod, expensesByPeriod } = aggregateByPeriod(normalized, periods);

  return {
    labels: periods.map((p) => p.label),
    incomeByPeriod,
    expensesByPeriod,
    isWeekly,
  };
}
