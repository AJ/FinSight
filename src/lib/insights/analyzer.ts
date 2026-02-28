/**
 * Transaction analytics analyzer.
 * Pre-aggregates transaction data before sending to LLM.
 */

import { Transaction } from '@/types';
import { TransactionAnalytics } from './types';
import { format, subMonths } from 'date-fns';

/**
 * Ensure a value is a proper Date object.
 */
function toDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v);
}

/**
 * Get the current month key in 'yyyy-MM' format.
 */
function getCurrentMonthKey(): string {
  return format(new Date(), 'yyyy-MM');
}

/**
 * Get the previous month key in 'yyyy-MM' format.
 */
function getPreviousMonthKey(): string {
  return format(subMonths(new Date(), 1), 'yyyy-MM');
}

/**
 * Group transactions by month.
 */
export function groupByMonth(transactions: Transaction[]): Record<string, { income: number; expenses: number }> {
  const byMonth: Record<string, { income: number; expenses: number }> = {};

  for (const txn of transactions) {
    const date = toDate(txn.date);
    const monthKey = format(date, 'yyyy-MM');

    if (!byMonth[monthKey]) {
      byMonth[monthKey] = { income: 0, expenses: 0 };
    }

    if (txn.isIncome) {
      byMonth[monthKey].income += txn.amount;
    } else {
      byMonth[monthKey].expenses += Math.abs(txn.amount);
    }
  }

  return byMonth;
}

/**
 * Group transactions by category.
 */
export function groupByCategory(transactions: Transaction[]): Record<string, { total: number; count: number; avg: number }> {
  const byCategory: Record<string, { total: number; count: number }> = {};

  for (const txn of transactions) {
    const category = txn.category?.id || 'uncategorized';

    if (!byCategory[category]) {
      byCategory[category] = { total: 0, count: 0 };
    }

    byCategory[category].total += Math.abs(txn.amount);
    byCategory[category].count += 1;
  }

  // Calculate averages
  const result: Record<string, { total: number; count: number; avg: number }> = {};
  for (const [category, data] of Object.entries(byCategory)) {
    result[category] = {
      total: data.total,
      count: data.count,
      avg: data.total / data.count,
    };
  }

  return result;
}

/**
 * Group expenses by category and month.
 */
export function groupByCategoryByMonth(transactions: Transaction[]): Record<string, Record<string, number>> {
  const result: Record<string, Record<string, number>> = {};

  const expenses = transactions.filter((t) => t.isExpense);

  for (const txn of expenses) {
    const category = txn.category?.id || 'uncategorized';
    const monthKey = format(toDate(txn.date), 'yyyy-MM');

    if (!result[category]) {
      result[category] = {};
    }

    if (!result[category][monthKey]) {
      result[category][monthKey] = 0;
    }

    result[category][monthKey] += Math.abs(txn.amount);
  }

  return result;
}

/**
 * Group expenses by day of week (0 = Sunday, 6 = Saturday).
 */
export function groupByDayOfWeek(transactions: Transaction[]): Record<number, { total: number; count: number }> {
  const result: Record<number, { total: number; count: number }> = {
    0: { total: 0, count: 0 },
    1: { total: 0, count: 0 },
    2: { total: 0, count: 0 },
    3: { total: 0, count: 0 },
    4: { total: 0, count: 0 },
    5: { total: 0, count: 0 },
    6: { total: 0, count: 0 },
  };

  const expenses = transactions.filter((t) => t.isExpense);

  for (const txn of expenses) {
    const dayOfWeek = toDate(txn.date).getDay();
    result[dayOfWeek].total += Math.abs(txn.amount);
    result[dayOfWeek].count += 1;
  }

  return result;
}

/**
 * Detect anomalies using z-score method.
 * Returns transactions with z-score > 2 (unusual spending).
 */
export function detectAnomalies(transactions: Transaction[]): Array<{ description: string; amount: number; zScore: number }> {
  const expenses = transactions.filter((t) => t.isExpense);

  if (expenses.length < 5) {
    return [];
  }

  const amounts = expenses.map((t) => Math.abs(t.amount));
  const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
  const variance = amounts.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / amounts.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) {
    return [];
  }

  const anomalies: Array<{ description: string; amount: number; zScore: number }> = [];

  for (const txn of expenses) {
    const amount = Math.abs(txn.amount);
    const zScore = (amount - mean) / stdDev;

    if (zScore > 2) {
      anomalies.push({
        description: txn.description,
        amount,
        zScore: Math.round(zScore * 100) / 100,
      });
    }
  }

  // Return top 5 anomalies by z-score
  return anomalies.sort((a, b) => b.zScore - a.zScore).slice(0, 5);
}

/**
 * Get top merchants by spending.
 */
export function getTopMerchants(transactions: Transaction[], limit: number = 5): Array<{ name: string; total: number; count: number }> {
  const expenses = transactions.filter((t) => t.isExpense);
  const byMerchant: Record<string, { total: number; count: number }> = {};

  for (const txn of expenses) {
    // Use merchant if available, otherwise first 30 chars of description
    const name = txn.merchant || txn.description.slice(0, 30);

    if (!byMerchant[name]) {
      byMerchant[name] = { total: 0, count: 0 };
    }

    byMerchant[name].total += Math.abs(txn.amount);
    byMerchant[name].count += 1;
  }

  return Object.entries(byMerchant)
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

/**
 * Get top categories by spending percentage.
 */
export function getTopCategories(
  transactions: Transaction[],
  byCategory: Record<string, { total: number; count: number; avg: number }>,
  limit: number = 5
): Array<{ category: string; total: number; percentage: number }> {
  const expenses = transactions.filter((t) => t.isExpense);
  const totalExpenses = expenses.reduce((sum, t) => sum + Math.abs(t.amount), 0);

  if (totalExpenses === 0) {
    return [];
  }

  return Object.entries(byCategory)
    .map(([category, data]) => ({
      category,
      total: data.total,
      percentage: Math.round((data.total / totalExpenses) * 100),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

/**
 * Calculate 3-month average for income and expenses.
 */
function calculateThreeMonthAvg(
  byMonth: Record<string, { income: number; expenses: number }>
): { income: number; expenses: number } {
  const months = Object.keys(byMonth).sort().slice(-3);

  if (months.length === 0) {
    return { income: 0, expenses: 0 };
  }

  const totals = months.reduce(
    (acc, month) => ({
      income: acc.income + byMonth[month].income,
      expenses: acc.expenses + byMonth[month].expenses,
    }),
    { income: 0, expenses: 0 }
  );

  return {
    income: Math.round(totals.income / months.length),
    expenses: Math.round(totals.expenses / months.length),
  };
}

/**
 * Main function to compute all analytics from transactions.
 */
export function getTransactionAnalytics(transactions: Transaction[]): TransactionAnalytics {
  console.log('[Analyzer] Computing analytics for', transactions.length, 'transactions');

  if (transactions.length === 0) {
    console.log('[Analyzer] No transactions, returning empty analytics');
    return {
      byMonth: {},
      byCategory: {},
      byCategoryByMonth: {},
      byDayOfWeek: { 0: { total: 0, count: 0 }, 1: { total: 0, count: 0 }, 2: { total: 0, count: 0 }, 3: { total: 0, count: 0 }, 4: { total: 0, count: 0 }, 5: { total: 0, count: 0 }, 6: { total: 0, count: 0 } },
      currentMonth: { income: 0, expenses: 0 },
      previousMonth: { income: 0, expenses: 0 },
      threeMonthAvg: { income: 0, expenses: 0 },
      topMerchants: [],
      topCategories: [],
      anomalies: [],
      totalTransactions: 0,
      dateRange: { start: '', end: '' },
    };
  }

  const byMonth = groupByMonth(transactions);
  const byCategory = groupByCategory(transactions);
  const byCategoryByMonth = groupByCategoryByMonth(transactions);
  const byDayOfWeek = groupByDayOfWeek(transactions);
  const anomalies = detectAnomalies(transactions);
  const topMerchants = getTopMerchants(transactions);
  const topCategories = getTopCategories(transactions, byCategory);

  console.log('[Analyzer] byMonth:', byMonth);
  console.log('[Analyzer] byCategory:', byCategory);
  console.log('[Analyzer] topCategories:', topCategories);
  console.log('[Analyzer] anomalies:', anomalies);

  const currentMonthKey = getCurrentMonthKey();
  const previousMonthKey = getPreviousMonthKey();

  const currentMonth = byMonth[currentMonthKey] || { income: 0, expenses: 0 };
  const previousMonth = byMonth[previousMonthKey] || { income: 0, expenses: 0 };
  const threeMonthAvg = calculateThreeMonthAvg(byMonth);

  // Get date range
  const dates = transactions.map((t) => toDate(t.date)).sort((a, b) => a.getTime() - b.getTime());
  const dateRange = {
    start: format(dates[0], 'yyyy-MM-dd'),
    end: format(dates[dates.length - 1], 'yyyy-MM-dd'),
  };

  return {
    byMonth,
    byCategory,
    byCategoryByMonth,
    byDayOfWeek,
    currentMonth,
    previousMonth,
    threeMonthAvg,
    topMerchants,
    topCategories,
    anomalies,
    totalTransactions: transactions.length,
    dateRange,
  };
}
