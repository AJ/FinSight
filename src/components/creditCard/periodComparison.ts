import { format, subMonths, startOfMonth, endOfMonth } from "date-fns";

export interface TransactionLike {
  date: Date;
  sourceType?: string;
  isExpense: boolean;
  amount: number;
  category?: { id: string } | null;
}

export interface PeriodData {
  total: number;
  byCategory: Map<string, number>;
}

export interface PeriodRange {
  start: Date;
  end: Date;
}

export interface PeriodComparisonResult {
  currentPeriod: PeriodRange;
  previousPeriod: PeriodRange;
  currentData: PeriodData;
  previousData: PeriodData;
  change: number;
  sortedCategories: string[];
}

export function computePeriodRanges(
  months: number,
  referenceDate: Date = new Date(),
): { current: PeriodRange; previous: PeriodRange } {
  const currentEnd = endOfMonth(referenceDate);
  const currentStart = startOfMonth(subMonths(referenceDate, months - 1));
  const previousEnd = endOfMonth(subMonths(referenceDate, months));
  const previousStart = startOfMonth(subMonths(referenceDate, months * 2 - 1));

  return {
    current: { start: currentStart, end: currentEnd },
    previous: { start: previousStart, end: previousEnd },
  };
}

export function filterCCTransactions(transactions: TransactionLike[]): TransactionLike[] {
  return transactions.filter(
    (t) => t.sourceType === "credit_card" && t.isExpense,
  );
}

export function filterByPeriod(
  transactions: TransactionLike[],
  start: Date,
  end: Date,
): TransactionLike[] {
  return transactions.filter((t) => {
    return t.date >= start && t.date <= end;
  });
}

export function aggregateByCategory(transactions: TransactionLike[]): PeriodData {
  const byCategory = new Map<string, number>();
  let total = 0;

  for (const txn of transactions) {
    const cat = txn.category?.id || "uncategorized";
    const amount = Math.abs(txn.amount);
    byCategory.set(cat, (byCategory.get(cat) || 0) + amount);
    total += amount;
  }

  return { total, byCategory };
}

export function computeChangePercent(current: number, previous: number): number {
  return previous > 0 ? ((current - previous) / previous) * 100 : 0;
}

export function getSortedCategoriesByCurrentSpend(
  current: PeriodData,
  previous: PeriodData,
): string[] {
  const cats = new Set([...current.byCategory.keys(), ...previous.byCategory.keys()]);
  return Array.from(cats).sort((a, b) => {
    const currentA = current.byCategory.get(a) || 0;
    const currentB = current.byCategory.get(b) || 0;
    return currentB - currentA;
  });
}

export function formatPeriodLabel(start: Date, end: Date): string {
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return format(start, "MMM yyyy");
  }
  return `${format(start, "MMM yyyy")} - ${format(end, "MMM yyyy")}`;
}

export function computePeriodComparison(
  transactions: TransactionLike[],
  months: number,
  referenceDate: Date = new Date(),
): PeriodComparisonResult {
  const { current, previous } = computePeriodRanges(months, referenceDate);
  const ccTxns = filterCCTransactions(transactions);

  const currentTxns = filterByPeriod(ccTxns, current.start, current.end);
  const previousTxns = filterByPeriod(ccTxns, previous.start, previous.end);

  const currentData = aggregateByCategory(currentTxns);
  const previousData = aggregateByCategory(previousTxns);

  const change = computeChangePercent(currentData.total, previousData.total);
  const sortedCategories = getSortedCategoriesByCurrentSpend(currentData, previousData);

  return {
    currentPeriod: current,
    previousPeriod: previous,
    currentData,
    previousData,
    change,
    sortedCategories,
  };
}
