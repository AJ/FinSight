import { describe, it, expect } from 'vitest';
import { defaultSubtype, roleOf, ROLE, categoriesFor, isValidCombo } from '@/lib/classification/subtypeCategories';
import { TransactionType } from '@/models/TransactionType';
// categoriesFor resolves ids through the Category registry, which is populated
// by the module-load side effects of categories.ts. Import it so the registry
// is populated (same precondition the app guarantees; categorizer.spec does
// the same).
import '@/lib/categorization/categories';

// The producer guarantee (spec §3.4): when no real subtype is known, a deficient
// row gets a direction-default subtype AND the signal that it was inferred
// (llmConfidence 0). The reason label itself is derived later by the review
// layer; this helper carries only the durable signal.
describe('defaultSubtype', () => {
  it('returns purchase + llmConfidence 0 for a debit', () => {
    expect(defaultSubtype(TransactionType.Debit)).toEqual({
      transactionSubType: 'purchase',
      llmConfidence: 0,
    });
  });

  it('returns income + llmConfidence 0 for a credit', () => {
    expect(defaultSubtype(TransactionType.Credit)).toEqual({
      transactionSubType: 'income',
      llmConfidence: 0,
    });
  });
});

// roleOf is a switch over the subtype union with an `assertNever` default, so it
// is compile-checked exhaustive — adding a subtype without a case fails to build.
// These tests pin the per-subtype role semantics the switch must preserve.
describe('roleOf', () => {
  it('purchase/bank_charge/charge -> spending', () => {
    expect(roleOf('purchase', TransactionType.Debit)).toBe(ROLE.SPENDING);
    expect(roleOf('bank_charge', TransactionType.Debit)).toBe(ROLE.SPENDING);
    expect(roleOf('charge', TransactionType.Debit)).toBe(ROLE.SPENDING);
  });

  it('income/rewards credit -> income', () => {
    expect(roleOf('income', TransactionType.Credit)).toBe(ROLE.INCOME);
    expect(roleOf('rewards', TransactionType.Credit)).toBe(ROLE.INCOME);
  });

  it('interest is direction-driven (debit spending, credit income)', () => {
    expect(roleOf('interest', TransactionType.Debit)).toBe(ROLE.SPENDING);
    expect(roleOf('interest', TransactionType.Credit)).toBe(ROLE.INCOME);
  });

  it('adjustment is direction-driven (debit spending, credit income)', () => {
    expect(roleOf('adjustment', TransactionType.Debit)).toBe(ROLE.SPENDING);
    expect(roleOf('adjustment', TransactionType.Credit)).toBe(ROLE.INCOME);
  });

  it('self_transfer/withdrawal/debt_payment/investment -> excluded', () => {
    for (const sub of ['self_transfer', 'withdrawal', 'debt_payment', 'investment'] as const) {
      expect(roleOf(sub, TransactionType.Debit)).toBe(ROLE.EXCLUDED);
    }
  });

  it('refund -> undefined (an offset has no gross role)', () => {
    expect(roleOf('refund', TransactionType.Credit)).toBeUndefined();
  });

  it('undefined subtype -> undefined', () => {
    expect(roleOf(undefined, TransactionType.Debit)).toBeUndefined();
  });
});

// categoriesFor is the M:N subtype→category map. It drives the review-dropdown
// cascade and the invalid_subtype_category reason, so its sets must be exactly
// the categories reachable under each subtype.
describe('categoriesFor', () => {
  it('returns the spending categories for purchase', () => {
    const ids = categoriesFor('purchase').map((c) => c.id);
    expect(ids).toHaveLength(13);
    expect(ids).toEqual(expect.arrayContaining([
      'groceries', 'dining', 'transportation', 'utilities', 'housing',
      'healthcare', 'entertainment', 'shopping', 'bills', 'insurance',
      'education', 'travel', 'other',
    ]));
    // A purchase can never be income or a fee.
    expect(ids).not.toContain('income');
    expect(ids).not.toContain('fees');
  });

  it('returns the single-category set for each scalar subtype', () => {
    expect(categoriesFor('bank_charge').map((c) => c.id)).toEqual(['fees']);
    expect(categoriesFor('income').map((c) => c.id)).toEqual(['income']);
    expect(categoriesFor('interest').map((c) => c.id)).toEqual(['interest']);
    expect(categoriesFor('rewards').map((c) => c.id)).toEqual(['cashback']);
    expect(categoriesFor('withdrawal').map((c) => c.id)).toEqual(['cash_withdrawal']);
    expect(categoriesFor('investment').map((c) => c.id)).toEqual(['investment']);
    expect(categoriesFor('self_transfer').map((c) => c.id)).toEqual(['transfer']);
    expect(categoriesFor('adjustment').map((c) => c.id)).toEqual(['adjustment']);
  });

  it('returns the two-category sets for charge and debt_payment', () => {
    expect(categoriesFor('charge').map((c) => c.id)).toEqual(['fees', 'taxes']);
    expect(categoriesFor('debt_payment').map((c) => c.id)).toEqual(['cc_bill_payment', 'loans']);
  });

  it('never returns undefined entries — every mapped id resolves to a registered Category', () => {
    // categoriesFor filters out ids that Category.fromId can't resolve. If a
    // category id in the map ever drifts from the registry, the set silently
    // shrinks, so assert every entry is a real Category instance.
    const subtypes = [
      'purchase', 'bank_charge', 'charge', 'income', 'interest', 'rewards',
      'withdrawal', 'debt_payment', 'investment', 'self_transfer', 'adjustment',
      'refund',
    ] as const;
    for (const sub of subtypes) {
      for (const c of categoriesFor(sub)) {
        expect(c).toBeTruthy();
        expect(typeof c.id).toBe('string');
      }
    }
  });

  it('refund unions purchase + bank_charge + charge with no duplicate categories', () => {
    // A refund keeps the category of whatever was refunded, so its reachable
    // set is the union of the spending-eligible categories. 'fees' is listed
    // under both bank_charge and charge, so a naive concat lists it twice — the
    // union must dedup.
    const ids = categoriesFor('refund').map((c) => c.id);

    // A member from each contributing subtype is reachable.
    expect(ids).toEqual(expect.arrayContaining(['groceries', 'fees', 'taxes']));
    // income is not part of the refund union.
    expect(ids).not.toContain('income');

    // No category appears twice — the 'fees' duplication regression guard.
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// isValidCombo is the predicate form of categoriesFor, used to flag a category
// that isn't reachable under its subtype (invalid_subtype_category).
describe('isValidCombo', () => {
  it('is true for reachable (subtype, category) pairs', () => {
    expect(isValidCombo('purchase', 'groceries')).toBe(true);
    expect(isValidCombo('income', 'income')).toBe(true);
    expect(isValidCombo('bank_charge', 'fees')).toBe(true);
    expect(isValidCombo('charge', 'taxes')).toBe(true);
    expect(isValidCombo('debt_payment', 'cc_bill_payment')).toBe(true);
  });

  it('is false when the category is not reachable under the subtype', () => {
    expect(isValidCombo('income', 'groceries')).toBe(false);
    expect(isValidCombo('purchase', 'income')).toBe(false);
    expect(isValidCombo('withdrawal', 'groceries')).toBe(false);
  });

  it('is false for an unknown category id', () => {
    expect(isValidCombo('purchase', 'nonexistent')).toBe(false);
  });

  it('treats refund as reachable for purchase/bank_charge/charge categories only', () => {
    expect(isValidCombo('refund', 'groceries')).toBe(true);
    expect(isValidCombo('refund', 'fees')).toBe(true);
    expect(isValidCombo('refund', 'taxes')).toBe(true);
    // income and cash_withdrawal are not in the refund union.
    expect(isValidCombo('refund', 'income')).toBe(false);
    expect(isValidCombo('refund', 'cash_withdrawal')).toBe(false);
  });
});
