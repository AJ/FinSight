export interface TransactionLike {
  sourceType?: string;
  isDebit: boolean;
  amount: number;
  description?: string;
  cardIssuer?: string;
  cardLastFour?: string;
  category?: { id: string } | null;
  date: Date | string;
}

export interface CategoryDataPoint {
  id: string;
  name: string;
  value: number;
  percentage: number;
  color: string;
}

export interface CardDataPoint {
  key: string;
  label: string;
  amount: number;
  percentage: number;
  color: string;
}

export interface MerchantDataPoint {
  name: string;
  count: number;
  amount: number;
}

export interface MonthlyDataPoint {
  month: string;
  amount: number;
}

const COLORS = [
  "oklch(0.65 0.185 45)",
  "oklch(0.65 0.15 220)",
  "oklch(0.68 0.14 150)",
  "oklch(0.75 0.15 70)",
  "oklch(0.70 0.15 300)",
  "oklch(0.60 0.12 180)",
];

export { COLORS };

export function filterCCSpendTransactions<T extends TransactionLike>(transactions: T[]): T[] {
  return transactions.filter((t) => t.sourceType === "credit_card" && t.isDebit);
}

export interface CategoryDisplayInfo {
  name: string;
  color: string;
}

export function aggregateByCategory(
  transactions: TransactionLike[],
  getCategoryDisplay: (catId: string) => CategoryDisplayInfo,
  limit = 6,
): CategoryDataPoint[] {
  const byCategory: Record<string, number> = {};

  for (const txn of transactions) {
    const catId = txn.category?.id || "uncategorized";
    byCategory[catId] = (byCategory[catId] || 0) + Math.abs(txn.amount);
  }

  const total = Object.values(byCategory).reduce((sum, v) => sum + v, 0);

  return Object.entries(byCategory)
    .map(([catId, amount]) => {
      const display = getCategoryDisplay(catId);
      return {
        id: catId,
        name: display.name,
        value: amount,
        percentage: total > 0 ? Math.round((amount / total) * 100) : 0,
        color: display.color,
      };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

export function aggregateByCard(transactions: TransactionLike[]): CardDataPoint[] {
  const byCard: Record<string, { issuer: string; lastFour: string; amount: number }> = {};

  for (const txn of transactions) {
    if (!txn.cardIssuer || !txn.cardLastFour) continue;
    const key = `${txn.cardIssuer}-${txn.cardLastFour}`;
    if (!byCard[key]) {
      byCard[key] = { issuer: txn.cardIssuer, lastFour: txn.cardLastFour, amount: 0 };
    }
    byCard[key].amount += Math.abs(txn.amount);
  }

  const total = Object.values(byCard).reduce((sum, c) => sum + c.amount, 0);

  return Object.entries(byCard)
    .map(([key, data], idx) => ({
      key,
      label: `${data.issuer.split(" ")[0]} ****${data.lastFour}`,
      amount: data.amount,
      percentage: total > 0 ? Math.round((data.amount / total) * 100) : 0,
      color: COLORS[idx % COLORS.length],
    }))
    .sort((a, b) => b.amount - a.amount);
}

export function extractMerchantName(description: string | undefined): string {
  const desc = description?.trim() || "Unknown";
  return desc.split(/\s+/).slice(0, 2).join(" ").substring(0, 20);
}

export function aggregateByMerchant(
  transactions: TransactionLike[],
  limit = 5,
): MerchantDataPoint[] {
  const byMerchant: Record<string, { count: number; amount: number }> = {};

  for (const txn of transactions) {
    const merchant = extractMerchantName(txn.description);
    if (!byMerchant[merchant]) {
      byMerchant[merchant] = { count: 0, amount: 0 };
    }
    byMerchant[merchant].count += 1;
    byMerchant[merchant].amount += Math.abs(txn.amount);
  }

  return Object.entries(byMerchant)
    .map(([name, data]) => ({
      name,
      count: data.count,
      amount: data.amount,
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

export function computeMonthlyTrend(
  transactions: TransactionLike[],
  months = 6,
  now: Date = new Date(),
): MonthlyDataPoint[] {
  const byMonth: Record<string, number> = {};

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    byMonth[key] = 0;
  }

  for (const txn of transactions) {
    const d = txn.date instanceof Date ? txn.date : new Date(txn.date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (key in byMonth) {
      byMonth[key] += Math.abs(txn.amount);
    }
  }

  return Object.entries(byMonth).map(([month, amount]) => ({
    month: new Date(month + "-01").toLocaleDateString("en-IN", { month: "short" }),
    amount,
  }));
}

export function computeTotalSpend(transactions: TransactionLike[]): number {
  return transactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
}
