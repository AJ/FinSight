import { Transaction } from "@/types";

/**
 * Dimensional Analysis Utilities
 *
 * Groups transactions by various dimensions for visualization.
 */

export type GroupingDimension =
  | "category"
  | "card"
  | "amountRange"
  | "country"
  | "cardHolder"
  | "month";

export interface GroupedSpending {
  key: string;
  label: string;
  amount: number;
  percentage: number;
  transactionCount: number;
  color?: string;
}

export interface AnalysisFilters {
  sourceType?: "bank" | "credit_card";
  type?: "income" | "expense" | "transfer";
  cardIssuer?: string;
  cardLastFour?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

// Amount range thresholds (in INR)
const AMOUNT_RANGES = [
  { max: 500, label: "Under ₹500", key: "<500" },
  { max: 2000, label: "₹500 - ₹2,000", key: "500-2000" },
  { max: 10000, label: "₹2,000 - ₹10,000", key: "2000-10000" },
  { max: Infinity, label: "Over ₹10,000", key: ">10000" },
];

// Color palette for charts
const CHART_COLORS = [
  "#3b82f6", // blue
  "#10b981", // green
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // purple
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#84cc16", // lime
  "#f97316", // orange
  "#6366f1", // indigo
];

/**
 * Get the group key for a transaction based on the dimension.
 */
export function getGroupKey(txn: Transaction, dimension: GroupingDimension): string {
  switch (dimension) {
    case "category":
      return txn.category || "uncategorized";

    case "card":
      if (txn.sourceType === "credit_card" && txn.cardIssuer) {
        return `${txn.cardIssuer}-****${txn.cardLastFour}`;
      }
      return "bank";

    case "amountRange":
      const abs = Math.abs(txn.amount);
      for (const range of AMOUNT_RANGES) {
        if (abs < range.max) {
          return range.key;
        }
      }
      return ">10000";

    case "country":
      if (!txn.currency || txn.currency === "INR") {
        return "India";
      }
      return `International (${txn.currency})`;

    case "cardHolder":
      if (txn.cardHolder) {
        return txn.cardHolder;
      }
      return "Primary";

    case "month":
      const date = txn.date instanceof Date ? txn.date : new Date(txn.date);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

    default:
      return "other";
  }
}

/**
 * Get a human-readable label for a group key.
 */
export function getDimensionLabel(key: string, dimension: GroupingDimension): string {
  switch (dimension) {
    case "amountRange":
      const range = AMOUNT_RANGES.find((r) => r.key === key);
      return range?.label || key;

    case "month":
      // Convert "2024-01" to "Jan 2024"
      const [year, month] = key.split("-");
      const monthNames = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
      ];
      return `${monthNames[parseInt(month) - 1]} ${year}`;

    default:
      return key;
  }
}

/**
 * Apply filters to transactions.
 */
export function applyFilters(
  transactions: Transaction[],
  filters?: AnalysisFilters
): Transaction[] {
  if (!filters) return transactions;

  return transactions.filter((txn) => {
    if (filters.sourceType && txn.sourceType !== filters.sourceType) {
      return false;
    }
    if (filters.type && txn.type !== filters.type) {
      return false;
    }
    if (filters.cardIssuer && txn.cardIssuer !== filters.cardIssuer) {
      return false;
    }
    if (filters.cardLastFour && txn.cardLastFour !== filters.cardLastFour) {
      return false;
    }
    if (filters.dateFrom || filters.dateTo) {
      const date = txn.date instanceof Date ? txn.date : new Date(txn.date);
      if (filters.dateFrom && date < filters.dateFrom) {
        return false;
      }
      if (filters.dateTo && date > filters.dateTo) {
        return false;
      }
    }
    return true;
  });
}

/**
 * Group transactions by a dimension and calculate spending.
 */
export function groupTransactions(
  transactions: Transaction[],
  dimension: GroupingDimension,
  filters?: AnalysisFilters
): GroupedSpending[] {
  const filtered = applyFilters(transactions, filters);

  // Only include expenses for spending analysis
  const expenses = filtered.filter(
    (t) => t.type === "expense" || t.sourceType === "credit_card"
  );

  const groups = new Map<string, { amount: number; count: number }>();

  for (const txn of expenses) {
    const key = getGroupKey(txn, dimension);
    const existing = groups.get(key) || { amount: 0, count: 0 };
    groups.set(key, {
      amount: existing.amount + Math.abs(txn.amount),
      count: existing.count + 1,
    });
  }

  const total = Array.from(groups.values()).reduce((sum, g) => sum + g.amount, 0);

  return Array.from(groups.entries())
    .map(([key, data], index) => ({
      key,
      label: getDimensionLabel(key, dimension),
      amount: data.amount,
      percentage: total > 0 ? (data.amount / total) * 100 : 0,
      transactionCount: data.count,
      color: CHART_COLORS[index % CHART_COLORS.length],
    }))
    .sort((a, b) => b.amount - a.amount);
}

/**
 * Get period-over-period comparison data.
 */
export function getPeriodComparison(
  transactions: Transaction[],
  currentPeriod: { start: Date; end: Date },
  previousPeriod: { start: Date; end: Date }
): {
  current: GroupedSpending[];
  previous: GroupedSpending[];
  change: number;
} {
  const current = groupTransactions(transactions, "category", {
    dateFrom: currentPeriod.start,
    dateTo: currentPeriod.end,
  });

  const previous = groupTransactions(transactions, "category", {
    dateFrom: previousPeriod.start,
    dateTo: previousPeriod.end,
  });

  const currentTotal = current.reduce((sum, g) => sum + g.amount, 0);
  const previousTotal = previous.reduce((sum, g) => sum + g.amount, 0);

  const change = previousTotal > 0
    ? ((currentTotal - previousTotal) / previousTotal) * 100
    : 0;

  return { current, previous, change };
}

/**
 * Get monthly spending trend.
 */
export function getMonthlyTrend(
  transactions: Transaction[],
  months: number = 6
): GroupedSpending[] {
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);

  return groupTransactions(transactions, "month", {
    dateFrom: startDate,
    dateTo: now,
  });
}
