import { describe, it, expect } from 'vitest';

// Import categories FIRST
import '@/lib/categorization/categories';

// Then check if the Category instance is the same across different import paths
import { Category as CategoryFromTypes } from '@/types';
import { Category as CategoryFromModels } from '@/models';
import { Category as CategoryFromModelsDirect } from '@/models/Category';

describe('Category module identity', () => {
  it('all Category imports point to same class', () => {
    expect(CategoryFromTypes).toBe(CategoryFromModels);
    expect(CategoryFromTypes).toBe(CategoryFromModelsDirect);
    expect(CategoryFromModels).toBe(CategoryFromModelsDirect);
  });

  it('registry is populated across all imports', () => {
    expect(CategoryFromTypes.fromId('dining')).toBeDefined();
    expect(CategoryFromModels.fromId('dining')).toBeDefined();
    expect(CategoryFromModelsDirect.fromId('dining')).toBeDefined();
    expect(CategoryFromTypes.getAll().length).toBeGreaterThan(20);
  });
});
