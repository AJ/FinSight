export interface CategoryLike {
  id?: string;
  name?: string;
  color?: string;
  isIncome?: boolean;
  isExpense?: boolean;
}

export interface TransactionLike {
  amount: number;
  category?: { id?: string; isIncome?: boolean; isExpense?: boolean } | null;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
}

export function reorderForContrast<T extends { color: string }>(
  items: T[],
): T[] {
  if (items.length <= 2) return items;
  const remaining = [...items];
  const result: T[] = [remaining.shift()!];

  while (remaining.length > 0) {
    const lastColor = result[result.length - 1].color;
    let bestIdx = 0;
    let bestDist = -1;
    for (let i = 0; i < remaining.length; i++) {
      const dist = colorDistance(lastColor, remaining[i].color);
      if (dist > bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    result.push(remaining.splice(bestIdx, 1)[0]);
  }

  return result;
}

export interface PieChartData {
  labels: string[];
  data: number[];
  colors: string[];
}

export function aggregateSpendByCategory(
  transactions: TransactionLike[],
): Record<string, number> {
  const byCategory: Record<string, number> = {};
  for (const t of transactions) {
    if (t.category?.isIncome) continue;
    if (t.category?.isExpense === false) continue;
    const amount = Math.abs(t.amount);
    const categoryId = t.category?.id || 'uncategorized';
    byCategory[categoryId] = (byCategory[categoryId] || 0) + amount;
  }
  return byCategory;
}

export function buildPieChartData(
  byCategory: Record<string, number>,
  categoryLookup: (id: string) => CategoryLike,
  maxSlices: number = 8,
): PieChartData {
  const sorted = Object.entries(byCategory)
    .sort(([, a], [, b]) => b - a)
    .slice(0, maxSlices);

  const total = sorted.reduce((sum, [, amount]) => sum + amount, 0);

  const items = sorted.map(([categoryId, amount]) => ({
    categoryId,
    amount,
    color: categoryLookup(categoryId).color || '#6b7280',
  }));

  const reordered = reorderForContrast(items);

  const labels: string[] = [];
  const data: number[] = [];
  const colors: string[] = [];

  for (const { categoryId, amount } of reordered) {
    const catInfo = categoryLookup(categoryId);
    const percentage = total > 0 ? ((amount / total) * 100).toFixed(1) : '0.0';
    labels.push(`${catInfo.name || categoryId} (${percentage}%)`);
    data.push(amount);
  }
  colors.push(...reordered.map((item) => item.color));

  return { labels, data, colors };
}
