import { describe, it, expect, vi, beforeEach } from 'vitest';

import { teachMerchantRuleFromTransaction } from '@/lib/services/merchantRuleService';

vi.mock('@/lib/services/merchantRuleService', () => ({
  teachMerchantRuleFromTransaction: vi.fn(),
}));

import {
  buildStoredTransactionCategoryUpdate,
  handleStoredTransactionManualCategoryEdit,
} from '@/lib/services/storedTransactionEditService';
import { makeTransaction } from '@tests/unit/factories';
import { CategorizedBy } from '@/models';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildStoredTransactionCategoryUpdate', () => {
  it('sets category from valid id', () => {
    const txn = makeTransaction({ category: { id: 'old', name: 'Old', type: 1, keywords: [] } as any });
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

    // Category.fromId returns null for unknown IDs, so falls back to transaction.category
    expect(result.category.id).toBe(originalCategory);
  });
});

describe('handleStoredTransactionManualCategoryEdit', () => {
  it('calls teachMerchantRuleFromTransaction once', () => {
    const txn = makeTransaction();
    handleStoredTransactionManualCategoryEdit(txn, 'groceries');

    expect(teachMerchantRuleFromTransaction).toHaveBeenCalledOnce();
  });

  it('uses CategorizedBy.Manual', () => {
    const txn = makeTransaction();
    const result = handleStoredTransactionManualCategoryEdit(txn, 'groceries');

    expect(result.categorizedBy).toBe(CategorizedBy.Manual);
  });

  it('returns updated transaction with correct category', () => {
    const txn = makeTransaction();
    const result = handleStoredTransactionManualCategoryEdit(txn, 'groceries');

    expect(result.category.id).toBe('groceries');
    expect(result.needsReview).toBe(false);
  });
});
