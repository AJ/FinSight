import { describe, it, expect, beforeEach } from 'vitest';

import { useCategoryStore } from '@/lib/store/categoryStore';
import { Category, CategoryType } from '@/models';

beforeEach(() => {
  useCategoryStore.setState({ categories: [] });
});

function makeCategory(
  id: string,
  type: CategoryType = CategoryType.Expense,
  keywords: string[] = [],
): Category {
  return new Category(id, id, type, keywords);
}

describe('categoryStore', () => {
  describe('addCategory', () => {
    it('appends a category', () => {
      useCategoryStore.getState().addCategory(makeCategory('groceries'));
      expect(useCategoryStore.getState().categories).toHaveLength(1);
      expect(useCategoryStore.getState().categories[0].id).toBe('groceries');
    });

    it('preserves existing categories', () => {
      useCategoryStore.getState().addCategory(makeCategory('groceries'));
      useCategoryStore.getState().addCategory(makeCategory('dining'));
      expect(useCategoryStore.getState().categories).toHaveLength(2);
    });
  });

  describe('updateCategory', () => {
    it('updates matching category fields', () => {
      useCategoryStore.getState().addCategory(makeCategory('groceries'));
      useCategoryStore.getState().updateCategory('groceries', { keywords: ['organic'] });

      const cat = useCategoryStore.getState().categories[0];
      expect(cat.keywords).toContain('organic');
    });

    it('preserves non-updated fields', () => {
      useCategoryStore.getState().addCategory(
        new Category('groceries', 'Groceries', CategoryType.Expense, ['food']),
      );
      useCategoryStore.getState().updateCategory('groceries', { keywords: ['organic', 'food'] });

      const cat = useCategoryStore.getState().categories[0];
      expect(cat.name).toBe('Groceries');
      expect(cat.type).toBe(CategoryType.Expense);
    });

    it('is a no-op for nonexistent id', () => {
      useCategoryStore.getState().addCategory(makeCategory('groceries'));
      useCategoryStore.getState().updateCategory('nonexistent', { keywords: ['test'] });

      expect(useCategoryStore.getState().categories).toHaveLength(1);
      // Existing category unchanged
      expect(useCategoryStore.getState().categories[0].keywords).toEqual([]);
    });

    it('does not mutate other categories', () => {
      useCategoryStore.getState().addCategory(makeCategory('groceries'));
      useCategoryStore.getState().addCategory(
        new Category('dining', 'Dining', CategoryType.Expense, ['restaurant']),
      );
      useCategoryStore.getState().updateCategory('groceries', { keywords: ['food'] });

      const dining = useCategoryStore.getState().categories.find((c) => c.id === 'dining');
      expect(dining!.keywords).toEqual(['restaurant']);
    });
  });

  describe('deleteCategory', () => {
    it('removes the matching category', () => {
      useCategoryStore.getState().addCategory(makeCategory('groceries'));
      useCategoryStore.getState().addCategory(makeCategory('dining'));
      useCategoryStore.getState().deleteCategory('groceries');

      expect(useCategoryStore.getState().categories).toHaveLength(1);
      expect(useCategoryStore.getState().categories[0].id).toBe('dining');
    });

    it('is a no-op for nonexistent id', () => {
      useCategoryStore.getState().addCategory(makeCategory('groceries'));
      useCategoryStore.getState().deleteCategory('nonexistent');
      expect(useCategoryStore.getState().categories).toHaveLength(1);
    });
  });

  describe('getCategoryById', () => {
    it('returns matching category', () => {
      useCategoryStore.getState().addCategory(makeCategory('groceries'));
      const found = useCategoryStore.getState().getCategoryById('groceries');
      expect(found).toBeDefined();
      expect(found!.id).toBe('groceries');
    });

    it('returns undefined for nonexistent id', () => {
      expect(useCategoryStore.getState().getCategoryById('nope')).toBeUndefined();
    });
  });

  describe('initializeDefaultCategories', () => {
    it('sets default categories when store is empty', () => {
      useCategoryStore.getState().initializeDefaultCategories();
      const cats = useCategoryStore.getState().categories;
      expect(cats.length).toBeGreaterThan(0);
      expect(cats.some((c) => c.id === 'groceries')).toBe(true);
    });

    it('resets to defaults when groceries category is missing', () => {
      useCategoryStore.getState().addCategory(makeCategory('custom'));
      useCategoryStore.getState().initializeDefaultCategories();
      const cats = useCategoryStore.getState().categories;
      expect(cats.some((c) => c.id === 'groceries')).toBe(true);
    });

    it('does not overwrite when groceries already exists', () => {
      const custom = new Category('groceries', 'Custom Groceries', CategoryType.Expense, ['custom']);
      useCategoryStore.getState().addCategory(custom);
      useCategoryStore.getState().initializeDefaultCategories();

      const cat = useCategoryStore.getState().getCategoryById('groceries');
      // Should keep the existing one since groceries exists
      expect(cat!.name).toBe('Custom Groceries');
    });
  });

  describe('persist migration', () => {
    it('resets categories to defaults when migrating from version 1', async () => {
      localStorage.setItem('category-storage', JSON.stringify({
        state: { categories: [{ id: 'custom', name: 'Custom', type: 'expense' }] },
        version: 1,
      }));

      const { useCategoryStore: freshStore } = await import('@/lib/store/categoryStore?' + Date.now());
      const categories = freshStore.getState().categories as { id: string; name: string; type: string }[];

      // Migration reset to DEFAULT_CATEGORIES — custom category should be gone
      expect(categories.length).toBeGreaterThan(1);
      expect(categories.some((c: { id: string }) => c.id === 'groceries')).toBe(true);
      expect(categories.find((c: { id: string }) => c.id === 'custom')).toBeUndefined();

      localStorage.removeItem('category-storage');
    });

    it('preserves categories when migrating from version 2+', async () => {
      const custom = [{ id: 'kept', name: 'Kept', type: 'expense' }];
      localStorage.setItem('category-storage', JSON.stringify({
        state: { categories: custom },
        version: 2,
      }));

      const { useCategoryStore: freshStore } = await import('@/lib/store/categoryStore?' + Date.now());
      const categories = freshStore.getState().categories as { id: string; name: string; type: string }[];

      // Same version → migrate returns state as-is
      expect(categories.some((c: { id: string }) => c.id === 'kept')).toBe(true);

      localStorage.removeItem('category-storage');
    });
  });
});
