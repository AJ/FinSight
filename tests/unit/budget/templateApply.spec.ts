import { describe, it, expect } from 'vitest';
import {
  computeTemplateAllocation,
} from '@/lib/budget/templateApply';
import { Category } from '@/models/Category';
import { makeTransaction, makeCategory } from '@tests/unit/factories';
import '@/lib/categorization/categories'; // Populate category registry for getBudgetableCategoryIds()

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build transactions for a given category across N recent months. */
function spendInCategory(categoryId: string, amountPerMonth: number, months: number) {
  const now = new Date();
  const txns: ReturnType<typeof makeTransaction>[] = [];
  for (let i = 0; i < months; i++) {
    const month = new Date(now.getFullYear(), now.getMonth() - i, 10);
    txns.push(
      makeTransaction({
        category: makeCategory(categoryId),
        amount: amountPerMonth,
        date: month,
      }),
    );
  }
  return txns;
}

/** Shorthand to call computeTemplateAllocation. */
function apply(opts: {
  template?: '50/30/20' | '60/20/20' | '70/20/10';
  localIncome?: number;
  medianIncome?: number;
  transactions?: ReturnType<typeof makeTransaction>[];
}) {
  return computeTemplateAllocation({
    template: opts.template ?? '50/30/20',
    localIncome: opts.localIncome ?? 0,
    medianIncome: opts.medianIncome ?? 0,
    transactions: opts.transactions ?? [],
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('computeTemplateAllocation', () => {
  // 1. Returns null when targetIncome is zero
  it('returns null when both localIncome and medianIncome are zero', () => {
    const result = apply({ localIncome: 0, medianIncome: 0 });
    expect(result).toBeNull();
  });

  // 2. Uses localIncome when > 0
  it('uses localIncome when it is greater than zero', () => {
    const result = apply({ localIncome: 60000, medianIncome: 50000 });
    expect(result).not.toBeNull();
    expect(result!.income).toBe(60000);
  });

  // 3. Falls back to medianIncome when localIncome is zero
  it('falls back to medianIncome when localIncome is zero', () => {
    const result = apply({ localIncome: 0, medianIncome: 45000 });
    expect(result).not.toBeNull();
    expect(result!.income).toBe(45000);
  });

  // 4. 50/30/20 split with spending history
  it('distributes 50/30/20 across NEEDS/WANTS/SAVES based on history', () => {
    const income = 60000;
    // Create history across all three groups
    const txns = [
      ...spendInCategory('groceries', 5000, 3),   // NEEDS
      ...spendInCategory('housing', 8000, 3),      // NEEDS
      ...spendInCategory('dining', 3000, 3),       // WANTS
      ...spendInCategory('investment', 4000, 3),   // SAVES
    ];

    const result = apply({ template: '50/30/20', localIncome: income, transactions: txns });
    expect(result).not.toBeNull();

    // NEEDS: groceries, housing → 2 cats → each gets round(60000 * 0.50 / 2)
    const needsPerCat = Math.round(income * 0.5 / 2);
    expect(result!.allocations['groceries']).toBe(needsPerCat);
    expect(result!.allocations['housing']).toBe(needsPerCat);

    // WANTS: dining → 1 cat → round(60000 * 0.30 / 1)
    const wantsPerCat = Math.round(income * 0.3 / 1);
    expect(result!.allocations['dining']).toBe(wantsPerCat);

    // SAVES: investment → 1 cat → round(60000 * 0.20 / 1)
    const savesPerCat = Math.round(income * 0.2 / 1);
    expect(result!.allocations['investment']).toBe(savesPerCat);
  });

  // 5. 60/20/20 split
  it('distributes 60/20/20 across NEEDS/WANTS/SAVES', () => {
    const income = 50000;
    const txns = [
      ...spendInCategory('groceries', 5000, 3),   // NEEDS
      ...spendInCategory('dining', 3000, 3),       // WANTS
      ...spendInCategory('investment', 4000, 3),   // SAVES
    ];

    const result = apply({ template: '60/20/20', localIncome: income, transactions: txns });
    expect(result).not.toBeNull();

    const needsPerCat = Math.round(income * 0.6 / 1);
    const wantsPerCat = Math.round(income * 0.2 / 1);
    const savesPerCat = Math.round(income * 0.2 / 1);

    expect(result!.allocations['groceries']).toBe(needsPerCat);
    expect(result!.allocations['dining']).toBe(wantsPerCat);
    expect(result!.allocations['investment']).toBe(savesPerCat);
  });

  // 6. 70/20/10 split
  it('distributes 70/20/10 across NEEDS/WANTS/SAVES', () => {
    const income = 50000;
    const txns = [
      ...spendInCategory('groceries', 5000, 3),
      ...spendInCategory('dining', 3000, 3),
      ...spendInCategory('investment', 4000, 3),
    ];

    const result = apply({ template: '70/20/10', localIncome: income, transactions: txns });
    expect(result).not.toBeNull();

    const needsPerCat = Math.round(income * 0.7 / 1);
    const wantsPerCat = Math.round(income * 0.2 / 1);
    const savesPerCat = Math.round(income * 0.1 / 1);

    expect(result!.allocations['groceries']).toBe(needsPerCat);
    expect(result!.allocations['dining']).toBe(wantsPerCat);
    expect(result!.allocations['investment']).toBe(savesPerCat);
  });

  // 7. Filters categories by spending history — no SAVES transactions
  it('excludes groups with no spending history', () => {
    const txns = [
      ...spendInCategory('groceries', 5000, 3),   // NEEDS only
      ...spendInCategory('dining', 3000, 3),       // WANTS only
    ];

    const result = apply({ localIncome: 40000, transactions: txns });
    expect(result).not.toBeNull();

    // SAVES categories should NOT appear in allocations
    const savesIds = Category.getByGroup('saves').map(c => c.id);
    for (const cat of savesIds) {
      expect(result!.allocations).not.toHaveProperty(cat);
    }

    // And SAVES categories should appear in hidden
    for (const cat of savesIds) {
      expect(result!.hidden).toContain(cat);
    }
  });

  // 8. Falls back to 7 default categories when no history
  it('uses default 7 categories when no spending history exists', () => {
    const result = apply({ localIncome: 50000, transactions: [] });
    expect(result).not.toBeNull();

    // Default needs: housing, groceries, utilities, transportation
    expect(result!.allocations).toHaveProperty('housing');
    expect(result!.allocations).toHaveProperty('groceries');
    expect(result!.allocations).toHaveProperty('utilities');
    expect(result!.allocations).toHaveProperty('transportation');

    // Default wants: dining, entertainment, shopping
    expect(result!.allocations).toHaveProperty('dining');
    expect(result!.allocations).toHaveProperty('entertainment');
    expect(result!.allocations).toHaveProperty('shopping');

    // Default saves: investment
    expect(result!.allocations).toHaveProperty('investment');
  });

  // 9. Handles empty NEEDS group gracefully
  it('assigns zero to needs when no NEEDS transactions exist', () => {
    // Only WANTS and SAVES transactions, no NEEDS
    const txns = [
      ...spendInCategory('dining', 3000, 3),       // WANTS
      ...spendInCategory('investment', 4000, 3),   // SAVES
    ];

    const result = apply({ localIncome: 40000, transactions: txns });
    expect(result).not.toBeNull();

    // No NEEDS categories should be in allocations
    const needsIds = Category.getByGroup('needs').map(c => c.id);
    for (const cat of needsIds) {
      expect(result!.allocations).not.toHaveProperty(cat);
    }

    // WANTS and SAVES should still be present
    expect(result!.allocations).toHaveProperty('dining');
    expect(result!.allocations).toHaveProperty('investment');
  });

  // 10. Hides categories not in any allocation
  it('hides categories that are not allocated', () => {
    const txns = [
      ...spendInCategory('groceries', 5000, 3),
    ];

    const result = apply({ localIncome: 40000, transactions: txns });
    expect(result).not.toBeNull();

    // groceries is allocated, so not hidden
    expect(result!.hidden).not.toContain('groceries');

    // dining has no history and is not a default in this path (history exists),
    // so it should be hidden
    expect(result!.hidden).toContain('dining');
    expect(result!.hidden).toContain('investment');
  });

  // 11. All three templates produce correct ratios on same input
  it('all three templates produce distinct correct ratios on identical input', () => {
    const txns = [
      ...spendInCategory('groceries', 5000, 3),
      ...spendInCategory('dining', 3000, 3),
      ...spendInCategory('investment', 4000, 3),
    ];
    const income = 60000;

    const r50 = apply({ template: '50/30/20', localIncome: income, transactions: txns })!;
    const r60 = apply({ template: '60/20/20', localIncome: income, transactions: txns })!;
    const r70 = apply({ template: '70/20/10', localIncome: income, transactions: txns })!;

    // Each NEEDS category gets a different amount per template
    expect(r50.allocations['groceries']).toBe(Math.round(income * 0.5 / 1));
    expect(r60.allocations['groceries']).toBe(Math.round(income * 0.6 / 1));
    expect(r70.allocations['groceries']).toBe(Math.round(income * 0.7 / 1));

    // WANTS
    expect(r50.allocations['dining']).toBe(Math.round(income * 0.3 / 1));
    expect(r60.allocations['dining']).toBe(Math.round(income * 0.2 / 1));
    expect(r70.allocations['dining']).toBe(Math.round(income * 0.2 / 1));

    // SAVES
    expect(r50.allocations['investment']).toBe(Math.round(income * 0.2 / 1));
    expect(r60.allocations['investment']).toBe(Math.round(income * 0.2 / 1));
    expect(r70.allocations['investment']).toBe(Math.round(income * 0.1 / 1));

    // Same income across all
    expect(r50.income).toBe(income);
    expect(r60.income).toBe(income);
    expect(r70.income).toBe(income);
  });
});
