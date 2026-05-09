import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  buildStoredTransactionCategoryUpdate,
  handleStoredTransactionManualCategoryEdit,
} from '@/lib/services/storedTransactionEditService';
import { makeTransaction, makeCategory } from '@tests/unit/factories';
import { CategorizedBy } from '@/models';
import { useMerchantRuleStore } from '@/lib/store/merchantRuleStore';

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useMerchantRuleStore.setState({ rules: [] });
});

describe('buildStoredTransactionCategoryUpdate', () => {
  it('sets category from valid id', () => {
    const txn = makeTransaction({ category: makeCategory('old') });
    const result = buildStoredTransactionCategoryUpdate(txn, 'groceries', CategorizedBy.Manual);

    expect(result.category.id).toBe('groceries');
  });

  it('sets needsReview to false', () => {
    const txn = makeTransaction({ needsReview: true });
    const result = buildStoredTransactionCategoryUpdate(txn, 'groceries', CategorizedBy.Manual);

    expect(result.needsReview).toBe(false);
  });

  it('sets categorizedBy', () => {
    const txn = makeTransaction();
    const result = buildStoredTransactionCategoryUpdate(txn, 'groceries', CategorizedBy.AI);

    expect(result.categorizedBy).toBe(CategorizedBy.AI);
  });

  it('falls back to original category when id is invalid', () => {
    const txn = makeTransaction();
    const originalCategory = txn.category.id;
    const result = buildStoredTransactionCategoryUpdate(txn, 'nonexistent_category_xyz', CategorizedBy.Manual);

    expect(result.category.id).toBe(originalCategory);
  });
});

describe('handleStoredTransactionManualCategoryEdit', () => {
  it('returns updated transaction with correct category and manual flag', () => {
    const txn = makeTransaction();
    const result = handleStoredTransactionManualCategoryEdit(txn, 'groceries');

    expect(result.category.id).toBe('groceries');
    expect(result.categorizedBy).toBe(CategorizedBy.Manual);
    expect(result.needsReview).toBe(false);
  });

  it('stores a merchant rule from the manual edit', () => {
    const txn = makeTransaction({ description: 'AMAZON PURCHASE' });
    handleStoredTransactionManualCategoryEdit(txn, 'groceries');

    const rules = useMerchantRuleStore.getState().rules;
    expect(rules.length).toBe(1);
    expect(rules[0].activeCategoryId).toBe('groceries');
  });
});
