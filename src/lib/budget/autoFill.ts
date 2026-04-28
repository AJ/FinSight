import { Transaction } from '@/types';
import { getBudgetableCategoryIds } from './categoryEligibility';
import { forecastAllCategories } from '@/lib/forecaster';

export interface AutoFillInput {
  localIncome: number;
  medianIncome: number;
  transactions: Transaction[];
}

export interface AutoFillResult {
  income: number;
  allocations: Record<string, number>;
  hidden: string[];
}

export function computeAutoFill(input: AutoFillInput): AutoFillResult | null {
  const { localIncome, medianIncome, transactions } = input;

  const categoryIds = getBudgetableCategoryIds();
  const forecasts = forecastAllCategories(transactions, categoryIds);
  const total = Object.values(forecasts).reduce((s, v) => s + v, 0);
  if (total === 0) return null;

  const budget = localIncome > 0 ? localIncome : medianIncome;
  if (!budget) return null;

  const threshold = total * 0.9;
  const sorted = Object.entries(forecasts)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a);

  const selected: string[] = [];
  let cumulative = 0;
  for (const [catId, amount] of sorted) {
    selected.push(catId);
    cumulative += amount;
    if (cumulative >= threshold) break;
  }

  const roundTo = budget < 20000 ? 100 : 1000;
  const selectedTotal = selected.reduce((s, id) => s + forecasts[id], 0);
  const allocations: Record<string, number> = {};
  for (const catId of selected) {
    const share = budget * (forecasts[catId] / selectedTotal);
    allocations[catId] = Math.round(share / roundTo) * roundTo;
  }

  const hidden = categoryIds.filter(id => !selected.includes(id));

  return {
    income: localIncome > 0 ? localIncome : budget,
    allocations,
    hidden,
  };
}
