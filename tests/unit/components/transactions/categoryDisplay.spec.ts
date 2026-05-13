import { describe, it, expect } from 'vitest';
import {
  iconMap,
  getCategoryIcon,
  getCategoryDisplay,
  categoryMatchesSearch,
  filterAndSortCategories,
} from '@/components/transactions/categoryDisplay';
import '@/lib/categorization/categories';

describe('iconMap', () => {
  it('has entries for expected icon names', () => {
    expect(iconMap['ShoppingCart']).toBeDefined();
    expect(iconMap['Utensils']).toBeDefined();
    expect(iconMap['Home']).toBeDefined();
  });

  it('every value is a truthy renderable (React component)', () => {
    for (const [name, icon] of Object.entries(iconMap)) {
      expect(icon, `iconMap["${name}"] should be truthy`).toBeTruthy();
    }
  });
});

describe('getCategoryIcon', () => {
  it('returns correct icon for known category', () => {
    const icon = getCategoryIcon('groceries');
    expect(icon).toBe(iconMap.ShoppingCart);
  });

  it('returns HelpCircle for unknown category', () => {
    const icon = getCategoryIcon('nonexistent');
    expect(icon).toBe(iconMap.HelpCircle);
  });

  it('returns HelpCircle for category without icon', () => {
    const icon = getCategoryIcon('other');
    expect(icon).toBe(iconMap.HelpCircle);
  });
});

describe('getCategoryDisplay', () => {
  it('returns display info for known category', () => {
    const display = getCategoryDisplay('groceries');
    expect(display.name).toBe('Groceries');
    expect(display.icon).toBe(iconMap.ShoppingCart);
    expect(display.color).toBeTruthy();
  });

  it('returns Unknown for unknown category', () => {
    const display = getCategoryDisplay('nonexistent');
    expect(display.name).toBe('Unknown');
    expect(display.icon).toBe(iconMap.HelpCircle);
  });
});

describe('categoryMatchesSearch', () => {
  const category = { name: 'Groceries', keywords: ['supermarket', 'grocery'], id: 'groceries' };

  it('matches empty search', () => {
    expect(categoryMatchesSearch(category, '')).toBe(true);
  });

  it('matches by name (case-insensitive)', () => {
    expect(categoryMatchesSearch(category, 'groc')).toBe(true);
    expect(categoryMatchesSearch(category, 'GROCERIES')).toBe(true);
  });

  it('matches by keyword', () => {
    expect(categoryMatchesSearch(category, 'super')).toBe(true);
    expect(categoryMatchesSearch(category, 'market')).toBe(true);
  });

  it('does not match unrelated term', () => {
    expect(categoryMatchesSearch(category, 'dining')).toBe(false);
  });
});

describe('filterAndSortCategories', () => {
  const categories = [
    { id: 'dining', name: 'Dining', keywords: ['restaurant'] },
    { id: 'groceries', name: 'Groceries', keywords: ['supermarket'] },
    { id: 'housing', name: 'Housing', keywords: ['rent'] },
    { id: 'other', name: 'Other', keywords: [] },
  ];

  it('returns all categories sorted alphabetically with Other pinned at bottom', () => {
    const result = filterAndSortCategories(categories, '');
    expect(result.map((c) => c.id)).toEqual(['dining', 'groceries', 'housing', 'other']);
  });

  it('filters by search term', () => {
    const result = filterAndSortCategories(categories, 'gro');
    expect(result.map((c) => c.id)).toEqual(['groceries']);
  });

  it('keeps Other at bottom even when filtered', () => {
    const result = filterAndSortCategories(categories, 'other');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('other');
  });

  it('returns empty for no matches', () => {
    const result = filterAndSortCategories(categories, 'zzzzz');
    expect(result).toHaveLength(0);
  });

  it('returns empty for empty input', () => {
    const result = filterAndSortCategories([], '');
    expect(result).toHaveLength(0);
  });

  it('works without Other category', () => {
    const noOther = categories.filter((c) => c.id !== 'other');
    const result = filterAndSortCategories(noOther, '');
    expect(result.map((c) => c.id)).toEqual(['dining', 'groceries', 'housing']);
  });
});
