import { Category, CategoryGroup, CategoryType } from '@/models';

const BUDGETABLE_EXTRAS = new Set(['investment', 'other']);

export type DisplayGroup = 'Needs' | 'Wants' | 'Saves';

const GROUP_DISPLAY_MAP: Record<CategoryGroup, DisplayGroup> = {
  needs: 'Needs',
  wants: 'Wants',
  saves: 'Saves',
};

export function getCategoryGroup(categoryId: string): DisplayGroup | null {
  const cat = Category.fromId(categoryId);
  if (!cat?.group) return null;
  return GROUP_DISPLAY_MAP[cat.group] ?? null;
}

export const groupStyles: Record<DisplayGroup, string> = {
  Needs: 'bg-blue-500/15 text-blue-400',
  Wants: 'bg-purple-500/15 text-purple-400',
  Saves: 'bg-green-500/15 text-green-400',
};

export interface PartitionResult {
  visible: string[];
  hidden: string[];
}

export function partitionCategories(
  allCategoryIds: string[],
  localHidden: string[],
  allocations: Record<string, number>,
): PartitionResult {
  const visible = allCategoryIds.filter(id => !localHidden.includes(id) && id in allocations);
  const hidden = allCategoryIds.filter(id => localHidden.includes(id) || !(id in allocations));
  return { visible, hidden };
}

export function getBudgetableCategories(): Category[] {
  const all = Category.getAll();
  return all.filter(c =>
    c.type === CategoryType.Expense || BUDGETABLE_EXTRAS.has(c.id)
  );
}

export function getBudgetableCategoryIds(): string[] {
  return getBudgetableCategories().map(c => c.id);
}

export function isBudgetable(categoryId: string): boolean {
  const all = Category.getAll();
  const cat = all.find(c => c.id === categoryId);
  if (!cat) return false;
  return cat.type === CategoryType.Expense || BUDGETABLE_EXTRAS.has(cat.id);
}
