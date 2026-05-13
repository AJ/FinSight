import { Transaction } from '@/types';
import { getBudgetableCategoryIds } from './categoryEligibility';
import { Category } from '@/models/Category';
import { forecastAllCategories } from '@/lib/forecaster';

export type TemplateId = '50/30/20' | '60/20/20' | '70/20/10';

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

  const needsCats = Category.getByGroup('needs').map(c => c.id);
  const wantsCats = Category.getByGroup('wants').map(c => c.id);
  const savesCats = Category.getByGroup('saves').map(c => c.id);

  const activeNeeds = hasHistory ? needsCats.filter(id => forecasts[id] > 0) : needsCats.filter(id => DEFAULT_NEEDS.includes(id));
  const activeWants = hasHistory ? wantsCats.filter(id => forecasts[id] > 0) : wantsCats.filter(id => DEFAULT_WANTS.includes(id));
  const activeSaves = hasHistory ? savesCats.filter(id => forecasts[id] > 0) : savesCats.filter(id => DEFAULT_SAVES.includes(id));

  const allocations: Record<string, number> = {};
  const needsPerCat = activeNeeds.length > 0 ? Math.round(targetIncome * needsPct / activeNeeds.length) : 0;
  const wantsPerCat = activeWants.length > 0 ? Math.round(targetIncome * wantsPct / activeWants.length) : 0;
  const savesPerCat = activeSaves.length > 0 ? Math.round(targetIncome * savesPct / activeSaves.length) : 0;

  activeNeeds.forEach(id => { allocations[id] = needsPerCat; });
  activeWants.forEach(id => { allocations[id] = wantsPerCat; });
  activeSaves.forEach(id => { allocations[id] = savesPerCat; });

  const hidden = categoryIds.filter(id => !(id in allocations));

  return {
    income: localIncome > 0 ? localIncome : targetIncome,
    allocations,
    hidden,
  };
}
