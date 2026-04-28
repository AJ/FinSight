import { Transaction } from '@/types';
import { getBudgetableCategoryIds } from './categoryEligibility';
import { forecastAllCategories } from '@/lib/forecaster';

export type TemplateId = '50/30/20' | '60/20/20' | '70/20/10';

export const NEEDS = ['groceries', 'housing', 'utilities', 'healthcare', 'insurance', 'bills', 'taxes', 'fees', 'transportation'];
export const WANTS = ['dining', 'entertainment', 'shopping', 'travel', 'education'];
export const SAVES = ['investment', 'other', 'interest-expense'];

const DEFAULT_NEEDS = ['housing', 'groceries', 'utilities', 'transportation'];
const DEFAULT_WANTS = ['dining', 'entertainment', 'shopping'];
const DEFAULT_SAVES = ['investment'];

const SPLITS: Record<TemplateId, [number, number, number]> = {
  '50/30/20': [0.50, 0.30, 0.20],
  '60/20/20': [0.60, 0.20, 0.20],
  '70/20/10': [0.70, 0.20, 0.10],
};

export interface TemplateApplyInput {
  template: TemplateId;
  localIncome: number;
  medianIncome: number;
  transactions: Transaction[];
}

export interface TemplateApplyResult {
  income: number;
  allocations: Record<string, number>;
  hidden: string[];
}

export function computeTemplateAllocation(input: TemplateApplyInput): TemplateApplyResult | null {
  const { template, localIncome, medianIncome, transactions } = input;
  const [needsPct, wantsPct, savesPct] = SPLITS[template];
  const targetIncome = localIncome > 0 ? localIncome : (medianIncome > 0 ? medianIncome : 0);
  if (!targetIncome) return null;

  const categoryIds = getBudgetableCategoryIds();
  const forecasts = forecastAllCategories(transactions, categoryIds);
  const hasHistory = Object.values(forecasts).some(v => v > 0);

  let needsCats: string[];
  let wantsCats: string[];
  let savesCats: string[];

  if (hasHistory) {
    needsCats = categoryIds.filter(id => NEEDS.includes(id) && forecasts[id] > 0);
    wantsCats = categoryIds.filter(id => WANTS.includes(id) && forecasts[id] > 0);
    savesCats = categoryIds.filter(id => SAVES.includes(id) && forecasts[id] > 0);
  } else {
    needsCats = categoryIds.filter(id => DEFAULT_NEEDS.includes(id));
    wantsCats = categoryIds.filter(id => DEFAULT_WANTS.includes(id));
    savesCats = categoryIds.filter(id => DEFAULT_SAVES.includes(id));
  }

  const allocations: Record<string, number> = {};
  const needsPerCat = needsCats.length > 0 ? Math.round(targetIncome * needsPct / needsCats.length) : 0;
  const wantsPerCat = wantsCats.length > 0 ? Math.round(targetIncome * wantsPct / wantsCats.length) : 0;
  const savesPerCat = savesCats.length > 0 ? Math.round(targetIncome * savesPct / savesCats.length) : 0;

  needsCats.forEach(id => { allocations[id] = needsPerCat; });
  wantsCats.forEach(id => { allocations[id] = wantsPerCat; });
  savesCats.forEach(id => { allocations[id] = savesPerCat; });

  const hidden = categoryIds.filter(id => !(id in allocations));

  return {
    income: localIncome > 0 ? localIncome : targetIncome,
    allocations,
    hidden,
  };
}
