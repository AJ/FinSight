import { Category, CategoryType } from '@/models';

const BUDGETABLE_EXTRAS = new Set(['investment', 'other']);

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
