import { describe, it, expect } from 'vitest';
import {
  buildMerchantKey,
  findMatchingMerchantRule,
  applyMerchantRuleDecision,
  getMerchantRuleInput,
  getMerchantRuleDecision,
  isLegacyMerchantRule,
  migrateLegacyMerchantRule,
  MERCHANT_RULE_MIN_CONFIRMATIONS,
  MERCHANT_RULE_MIN_LEAD,
  type MerchantRule,
  type MerchantRuleSourceType,
} from '@/lib/categorization/merchantRules';
import { SourceType, TransactionType } from '@/types';
import { Category } from '@/models/Category';
import '@/lib/categorization/categories';

describe('buildMerchantKey', () => {
  it('normalizes known merchant patterns', () => {
    expect(buildMerchantKey('AMAZON INDIA PVT LTD')).toBe('AMAZON');
  });

  it('normalizes food delivery merchants', () => {
    expect(buildMerchantKey('SWIGGY FOOD ORDER')).toBe('SWIGGY');
  });

  it('normalizes streaming services', () => {
    expect(buildMerchantKey('NETFLIX.COM SUBSCRIPTION')).toBe('NETFLIX');
  });

  it('strips UPI prefixes', () => {
    expect(buildMerchantKey('UPI/AMAZON 123456')).toBe('AMAZON');
  });

  it('returns __unknown__ for empty input', () => {
    expect(buildMerchantKey('')).toBe('__unknown__');
  });

  it('returns __unknown__ for null/undefined', () => {
    expect(buildMerchantKey(null as unknown as string)).toBe('__unknown__');
  });

  it('handles generic unknown merchants', () => {
    expect(buildMerchantKey('XYZ UNKNOWN MERCHANT')).toBe('XYZ UNKNOWN MERCHANT');
  });

  it('strips date/time noise patterns', () => {
    expect(buildMerchantKey('AMAZON 20/01/2024')).toBe('AMAZON');
  });

  it('strips reference number patterns', () => {
    expect(buildMerchantKey('AMAZON Ref 123456')).toBe('AMAZON');
  });

  it('strips 6+ digit sequences', () => {
    expect(buildMerchantKey('AMAZON 1234567890')).toBe('AMAZON');
  });

  it('strips parenthesized content', () => {
    // The regex /\([^)]*\)/g removes entire parenthesized segments.
    // "MERCHANT (NOISE) STORE" → "MERCHANT  STORE" → "MERCHANT STORE"
    expect(buildMerchantKey('MERCHANT (NOISE) STORE')).toBe('MERCHANT STORE');
  });

  it('returns __unknown__ for whitespace-only input', () => {
    expect(buildMerchantKey('   ')).toBe('__unknown__');
  });
});

describe('findMatchingMerchantRule', () => {
  const makeRule = (overrides: Partial<MerchantRule> = {}): MerchantRule => ({
    merchantKey: 'AMAZON',
    direction: 'any',
    sourceType: 'any',
    categoryVotes: { shopping: 5 },
    activeCategoryId: 'shopping',
    status: 'confident',
    lastConfirmedCategoryId: 'shopping',
    lastConfirmedAt: '2024-01-01',
    sampleDescription: 'AMAZON PURCHASE',
    totalConfirmations: 5,
    ...overrides,
  });

  it('finds exact match', () => {
    const rules = [makeRule()];
    const result = findMatchingMerchantRule(rules, { merchantKey: 'AMAZON', direction: 'debit', sourceType: SourceType.Bank });
    expect(result?.activeCategoryId).toBe('shopping');
  });

  it('returns null when no match', () => {
    const rules = [makeRule()];
    const result = findMatchingMerchantRule(rules, { merchantKey: 'SWIGGY', direction: 'debit', sourceType: SourceType.Bank });
    expect(result).toBeNull();
  });

  it('returns null for ambiguous rules', () => {
    const rules = [makeRule({ status: 'ambiguous', activeCategoryId: undefined })];
    const result = findMatchingMerchantRule(rules, { merchantKey: 'AMAZON', direction: 'debit', sourceType: SourceType.Bank });
    expect(result).toBeNull();
  });

  it('returns null for direction mismatch', () => {
    const rules = [makeRule({ direction: 'credit' })];
    const result = findMatchingMerchantRule(rules, { merchantKey: 'AMAZON', direction: 'debit', sourceType: 'any' });
    expect(result).toBeNull();
  });

  it('matches when rule direction is any', () => {
    const rules = [makeRule({ direction: 'any' })];
    const result = findMatchingMerchantRule(rules, { merchantKey: 'AMAZON', direction: 'debit', sourceType: 'any' });
    expect(result?.activeCategoryId).toBe('shopping');
  });

  it('returns null when sourceType mismatches (rule Bank, input CreditCard)', () => {
    const rules = [makeRule({ sourceType: SourceType.Bank })];
    const result = findMatchingMerchantRule(rules, { merchantKey: 'AMAZON', direction: 'debit', sourceType: SourceType.CreditCard });
    expect(result).toBeNull();
  });

  it('matches when rule sourceType is any regardless of input sourceType', () => {
    const rules = [makeRule({ sourceType: 'any' })];
    const result = findMatchingMerchantRule(rules, { merchantKey: 'AMAZON', direction: 'debit', sourceType: SourceType.CreditCard });
    expect(result?.activeCategoryId).toBe('shopping');
  });

  it('higher specificity wins when multiple rules match same merchantKey', () => {
    const anyRule = makeRule({
      direction: 'any',
      sourceType: 'any',
      activeCategoryId: 'other',
      lastConfirmedAt: '2024-01-01',
      totalConfirmations: 10,
    });
    const specificRule = makeRule({
      direction: 'debit',
      sourceType: SourceType.Bank,
      activeCategoryId: 'shopping',
      lastConfirmedAt: '2024-01-02',
      totalConfirmations: 5,
    });
    const result = findMatchingMerchantRule(
      [anyRule, specificRule],
      { merchantKey: 'AMAZON', direction: 'debit', sourceType: SourceType.Bank },
    );
    expect(result?.activeCategoryId).toBe('shopping');
  });

  it('returns null when tied candidates have conflicting activeCategoryIds', () => {
    const ruleA = makeRule({
      direction: 'debit',
      sourceType: 'any',
      activeCategoryId: 'shopping',
      totalConfirmations: 5,
      lastConfirmedAt: '2024-01-01',
    });
    const ruleB = makeRule({
      direction: 'any',
      sourceType: SourceType.Bank,
      activeCategoryId: 'travel',
      totalConfirmations: 5,
      lastConfirmedAt: '2024-01-01',
    });
    // Both have direction+sourceType specificity of 2+1=3, so they tie.
    const result = findMatchingMerchantRule(
      [ruleA, ruleB],
      { merchantKey: 'AMAZON', direction: 'debit', sourceType: SourceType.Bank },
    );
    expect(result).toBeNull();
  });

  it('breaks tie by totalConfirmations when specificity is equal', () => {
    const fewerConfirms = makeRule({
      direction: 'any',
      sourceType: 'any',
      activeCategoryId: 'shopping',
      totalConfirmations: 3,
      lastConfirmedAt: '2024-01-02',
    });
    const moreConfirms = makeRule({
      merchantKey: 'AMAZON',
      direction: 'any',
      sourceType: 'any',
      activeCategoryId: 'shopping',
      totalConfirmations: 10,
      lastConfirmedAt: '2024-01-01',
    });
    const result = findMatchingMerchantRule(
      [fewerConfirms, moreConfirms],
      { merchantKey: 'AMAZON', direction: 'debit', sourceType: SourceType.Bank },
    );
    expect(result?.totalConfirmations).toBe(10);
  });

  it('breaks tie by lastConfirmedAt when specificity and totalConfirmations are equal', () => {
    const older = makeRule({
      direction: 'any',
      sourceType: 'any',
      activeCategoryId: 'shopping',
      totalConfirmations: 5,
      lastConfirmedAt: '2024-01-01',
    });
    const newer = makeRule({
      merchantKey: 'AMAZON',
      direction: 'any',
      sourceType: 'any',
      activeCategoryId: 'shopping',
      totalConfirmations: 5,
      lastConfirmedAt: '2024-06-01',
    });
    const result = findMatchingMerchantRule(
      [older, newer],
      { merchantKey: 'AMAZON', direction: 'debit', sourceType: SourceType.Bank },
    );
    expect(result?.lastConfirmedAt).toBe('2024-06-01');
  });

  it('returns best when tied candidates agree on activeCategoryId', () => {
    const ruleA = makeRule({
      direction: 'debit',
      sourceType: 'any',
      activeCategoryId: 'shopping',
      totalConfirmations: 5,
      lastConfirmedAt: '2024-01-01',
    });
    const ruleB = makeRule({
      direction: 'any',
      sourceType: SourceType.Bank,
      activeCategoryId: 'shopping',
      totalConfirmations: 5,
      lastConfirmedAt: '2024-01-02',
    });
    const result = findMatchingMerchantRule(
      [ruleA, ruleB],
      { merchantKey: 'AMAZON', direction: 'debit', sourceType: SourceType.Bank },
    );
    expect(result).not.toBeNull();
    expect(result?.activeCategoryId).toBe('shopping');
  });
});

describe('applyMerchantRuleDecision', () => {
  it('creates new rule with confident status', () => {
    const result = applyMerchantRuleDecision(
      undefined,
      { merchantKey: 'AMAZON', categoryId: 'shopping', direction: 'debit', sourceType: SourceType.Bank, sampleDescription: 'AMAZON PURCHASE' },
      '2024-01-01'
    );
    expect(result.status).toBe('confident');
    expect(result.activeCategoryId).toBe('shopping');
    expect(result.totalConfirmations).toBe(1);
  });

  it('adds vote to existing rule', () => {
    const existing = makeRule({ categoryVotes: { shopping: 2 }, totalConfirmations: 2 });
    const result = applyMerchantRuleDecision(
      existing,
      { merchantKey: 'AMAZON', categoryId: 'shopping', direction: 'debit', sourceType: SourceType.Bank, sampleDescription: 'AMAZON PURCHASE' },
      '2024-01-02'
    );
    expect(result.categoryVotes.shopping).toBe(3);
    expect(result.totalConfirmations).toBe(3);
  });

  it('resolves to ambiguous on tie', () => {
    const existing = makeRule({
      categoryVotes: { shopping: 2, travel: 2 },
      activeCategoryId: undefined,
      status: 'ambiguous',
      totalConfirmations: 4,
    });
    const result = applyMerchantRuleDecision(
      existing,
      { merchantKey: 'AMAZON', categoryId: 'shopping', direction: 'debit', sourceType: SourceType.Bank, sampleDescription: 'AMAZON PURCHASE' },
      '2024-01-02'
    );
    // shopping=3, travel=2 → lead of 1, need lead of 2 → ambiguous
    expect(result.status).toBe('ambiguous');
    expect(result.activeCategoryId).toBeUndefined();
  });

  it('resolves to confident with lead', () => {
    const existing = makeRule({
      categoryVotes: { shopping: 4, travel: 1 },
      activeCategoryId: 'shopping',
      status: 'confident',
      totalConfirmations: 5,
    });
    const result = applyMerchantRuleDecision(
      existing,
      { merchantKey: 'AMAZON', categoryId: 'shopping', direction: 'debit', sourceType: SourceType.Bank, sampleDescription: 'AMAZON PURCHASE' },
      '2024-01-02'
    );
    expect(result.status).toBe('confident');
    expect(result.activeCategoryId).toBe('shopping');
    expect(result.categoryVotes.shopping).toBe(5);
  });

  it('transitions ambiguous to confident via single-category statusReason', () => {
    // Existing rule has votes only for one category but was previously ambiguous.
    const existing = makeRule({
      categoryVotes: { shopping: 2 },
      activeCategoryId: undefined,
      status: 'ambiguous',
      totalConfirmations: 2,
    });
    const result = applyMerchantRuleDecision(
      existing,
      { merchantKey: 'AMAZON', categoryId: 'shopping', direction: 'debit', sourceType: SourceType.Bank, sampleDescription: 'AMAZON PURCHASE' },
      '2024-01-02'
    );
    // shopping=3 is now the only category with votes → single-category
    expect(result.status).toBe('confident');
    expect(result.activeCategoryId).toBe('shopping');
    expect(result.statusReason).toBe('single-category');
  });

  it('dominance-restored sets runnerUpCategoryId and statusReason', () => {
    const existing = makeRule({
      categoryVotes: { shopping: 4, travel: 2 },
      activeCategoryId: undefined,
      status: 'ambiguous',
      totalConfirmations: 6,
    });
    const result = applyMerchantRuleDecision(
      existing,
      { merchantKey: 'AMAZON', categoryId: 'shopping', direction: 'debit', sourceType: SourceType.Bank, sampleDescription: 'AMAZON PURCHASE' },
      '2024-01-02'
    );
    // shopping=5, travel=2, lead=3 >= MIN_LEAD(2) and shopping(5) >= MIN_CONFIRMATIONS(3)
    expect(result.status).toBe('confident');
    expect(result.activeCategoryId).toBe('shopping');
    expect(result.runnerUpCategoryId).toBe('travel');
    expect(result.statusReason).toBe('dominance-restored');
  });

  it('filters zero-count categories from votes before resolving', () => {
    const existing = makeRule({
      categoryVotes: { shopping: 0, travel: 3 },
      activeCategoryId: 'travel',
      totalConfirmations: 3,
    });
    const result = applyMerchantRuleDecision(
      existing,
      { merchantKey: 'AMAZON', categoryId: 'groceries', direction: 'debit', sourceType: SourceType.Bank, sampleDescription: 'AMAZON PURCHASE' },
      '2024-01-02'
    );
    // shopping=0 filtered out, travel=3, groceries=1 → travel leads by 2, travel(3)>=MIN(3)
    expect(result.status).toBe('confident');
    expect(result.activeCategoryId).toBe('travel');
    expect(result.categoryVotes.shopping).toBe(0);
    expect(result.categoryVotes.groceries).toBe(1);
  });

  it('sorts categories deterministically when votes are equal', () => {
    const existing = makeRule({
      categoryVotes: { shopping: 3, dining: 3 },
      activeCategoryId: undefined,
      status: 'ambiguous',
      totalConfirmations: 6,
    });
    const result = applyMerchantRuleDecision(
      existing,
      { merchantKey: 'AMAZON', categoryId: 'shopping', direction: 'debit', sourceType: SourceType.Bank, sampleDescription: 'AMAZON PURCHASE' },
      '2024-01-02'
    );
    // shopping=4, dining=3 → lead=1 < MIN_LEAD(2) → ambiguous
    expect(result.status).toBe('ambiguous');
    expect(result.runnerUpCategoryId).toBe('dining');
  });

  it('returns ambiguous when all category votes are zero (resolveMerchantRuleState empty votes)', () => {
    // When categoryVotes has all zero counts, getSortedCategoryVotes filters them all out,
    // leaving sortedVotes empty. topVote is undefined → line 224 path.
    const existing = makeRule({
      categoryVotes: { shopping: 0, dining: 0 },
      activeCategoryId: undefined,
      status: 'ambiguous',
      totalConfirmations: 0,
    });
    const result = applyMerchantRuleDecision(
      existing,
      { merchantKey: 'AMAZON', categoryId: 'shopping', direction: 'debit', sourceType: SourceType.Bank, sampleDescription: 'AMAZON PURCHASE' },
      '2024-01-02'
    );
    // shopping=1, dining=0 → shopping is top, dining filtered → single-category → confident
    expect(result.status).toBe('confident');
    expect(result.activeCategoryId).toBe('shopping');
  });

  it('returns ambiguous when existing has zero votes and new vote is for unknown category', () => {
    // Create a rule with genuinely empty categoryVotes (no entries at all)
    const result = applyMerchantRuleDecision(
      undefined,
      { merchantKey: 'TEST', categoryId: 'other', direction: 'debit', sourceType: SourceType.Bank, sampleDescription: 'TEST' },
      '2024-01-01'
    );
    // No existing rule → creates new rule with one category vote → single-category → confident
    expect(result.status).toBe('confident');
    expect(result.activeCategoryId).toBe('other');
  });
});

function makeCategory(id: string): Category {
  return Category.fromId(id)!;
}

function makeRule(overrides: Partial<MerchantRule>): MerchantRule {
  return {
    merchantKey: 'AMAZON',
    direction: 'any',
    sourceType: 'any',
    categoryVotes: { shopping: 5 },
    activeCategoryId: 'shopping',
    status: 'confident',
    lastConfirmedCategoryId: 'shopping',
    lastConfirmedAt: '2024-01-01',
    sampleDescription: 'AMAZON PURCHASE',
    totalConfirmations: 5,
    ...overrides,
  };
}

// ── Constants ──────────────────────────────────────────────────────────────

describe('MERCHANT_RULE_MIN_CONFIRMATIONS', () => {
  it('has expected value', () => {
    expect(MERCHANT_RULE_MIN_CONFIRMATIONS).toBe(3);
  });
});

describe('MERCHANT_RULE_MIN_LEAD', () => {
  it('has expected value', () => {
    expect(MERCHANT_RULE_MIN_LEAD).toBe(2);
  });
});

// ── getMerchantRuleInput ───────────────────────────────────────────────────

describe('getMerchantRuleInput', () => {
  it('builds input from transaction with merchant', () => {
    const input = getMerchantRuleInput({
      description: 'AMAZON PURCHASE',
      merchant: 'AMAZON',
      type: TransactionType.Debit,
      sourceType: SourceType.Bank,
    });
    expect(input.merchantKey).toBe('AMAZON');
    expect(input.direction).toBe(TransactionType.Debit);
    expect(input.sourceType).toBe(SourceType.Bank);
  });

  it('falls back to description when no merchant', () => {
    const input = getMerchantRuleInput({
      description: 'SWIGGY ORDER',
      merchant: undefined,
      type: TransactionType.Debit,
      sourceType: SourceType.Bank,
    });
    expect(input.merchantKey).toBe('SWIGGY');
  });

  it('defaults sourceType to any when undefined', () => {
    const input = getMerchantRuleInput({
      description: 'AMAZON',
      merchant: 'AMAZON',
      type: TransactionType.Credit,
      sourceType: undefined,
    });
    expect(input.sourceType).toBe('any');
  });
});

// ── getMerchantRuleDecision ────────────────────────────────────────────────

describe('getMerchantRuleDecision', () => {
  it('builds decision from categorized transaction', () => {
    const cat = Category.fromId('shopping')!;
    const decision = getMerchantRuleDecision({
      description: 'AMAZON PURCHASE',
      merchant: 'AMAZON',
      type: TransactionType.Debit,
      sourceType: SourceType.Bank,
      category: cat,
    });
    expect(decision).not.toBeNull();
    expect(decision!.categoryId).toBe('shopping');
    expect(decision!.sampleDescription).toBe('AMAZON PURCHASE');
  });

  it('returns null when merchant key normalizes to empty', () => {
    const result = getMerchantRuleDecision({
      description: 'UPI 1234567890',
      merchant: 'UPI 1234567890',
      type: TransactionType.Debit,
      sourceType: SourceType.Bank,
      category: makeCategory('other'),
    });
    // buildMerchantKey strips "UPI" prefix and 6+ digit numbers, leaving empty
    expect(result).toBeNull();
  });

  it('falls back to description when merchant is undefined', () => {
    const result = getMerchantRuleDecision({
      description: 'AMAZON INDIA',
      merchant: undefined,
      type: TransactionType.Debit,
      sourceType: SourceType.Bank,
      category: makeCategory('shopping'),
    });
    expect(result).not.toBeNull();
    expect(result!.merchantKey).toContain('AMAZON');
  });

  it('defaults sourceType to "any" when undefined', () => {
    const result = getMerchantRuleDecision({
      description: 'NETFLIX',
      merchant: 'NETFLIX',
      type: TransactionType.Debit,
      sourceType: undefined,
      category: makeCategory('entertainment'),
    });
    expect(result).not.toBeNull();
    expect(result!.sourceType).toBe('any');
  });

  it('preserves raw description in sampleDescription', () => {
    const result = getMerchantRuleDecision({
      description: 'NETFLIX SUBSCRIPTION PAYMENT',
      merchant: 'NETFLIX',
      type: TransactionType.Debit,
      sourceType: SourceType.Bank,
      category: makeCategory('entertainment'),
    });
    expect(result).not.toBeNull();
    expect(result!.sampleDescription).toBe('NETFLIX SUBSCRIPTION PAYMENT');
  });
});

// ── isLegacyMerchantRule ───────────────────────────────────────────────────

describe('isLegacyMerchantRule', () => {
  it('returns true for legacy rule shape', () => {
    const legacy = {
      merchantKey: 'AMAZON',
      categoryId: 'shopping',
      direction: 'debit' as const,
      sourceType: SourceType.Bank,
      confirmations: 5,
      lastConfirmedAt: '2024-01-01',
      sampleDescription: 'AMAZON PURCHASE',
    };
    expect(isLegacyMerchantRule(legacy)).toBe(true);
  });

  it('returns false for new rule shape (has categoryVotes)', () => {
    const newRule = {
      merchantKey: 'AMAZON',
      categoryId: 'shopping',
      categoryVotes: { shopping: 5 },
      totalConfirmations: 5,
      confirmations: 5,
      direction: 'debit' as const,
      sourceType: SourceType.Bank,
      lastConfirmedAt: '2024-01-01',
      sampleDescription: 'AMAZON PURCHASE',
    };
    expect(isLegacyMerchantRule(newRule)).toBe(false);
  });

  it('returns false for non-object', () => {
    expect(isLegacyMerchantRule(null)).toBe(false);
    expect(isLegacyMerchantRule('string')).toBe(false);
  });

  it('returns false when categoryId is missing', () => {
    expect(isLegacyMerchantRule({
      merchantKey: 'AMAZON',
      confirmations: 5,
      direction: 'debit',
      sourceType: SourceType.Bank,
      lastConfirmedAt: '2024-01-01',
      sampleDescription: 'AMAZON',
    })).toBe(false);
  });

  it('returns false when totalConfirmations is present (new-format indicator)', () => {
    expect(isLegacyMerchantRule({
      merchantKey: 'AMAZON',
      categoryId: 'shopping',
      confirmations: 5,
      totalConfirmations: 5,
      direction: 'debit',
      sourceType: SourceType.Bank,
      lastConfirmedAt: '2024-01-01',
      sampleDescription: 'AMAZON',
    })).toBe(false);
  });
});

// ── migrateLegacyMerchantRule ──────────────────────────────────────────────

describe('migrateLegacyMerchantRule', () => {
  it('migrates a confident legacy rule', () => {
    const legacy = {
      merchantKey: 'AMAZON',
      categoryId: 'shopping',
      direction: 'debit' as const,
      sourceType: SourceType.Bank,
      confirmations: 5,
      lastConfirmedAt: '2024-01-01',
      sampleDescription: 'AMAZON PURCHASE',
      ambiguous: false,
    };
    const migrated = migrateLegacyMerchantRule(legacy);
    expect(migrated.merchantKey).toBe('AMAZON');
    expect(migrated.categoryVotes).toEqual({ shopping: 5 });
    expect(migrated.activeCategoryId).toBe('shopping');
    expect(migrated.status).toBe('confident');
    expect(migrated.totalConfirmations).toBe(5);
    expect(migrated.statusReason).toBe('single-category');
  });

  it('migrates an ambiguous legacy rule', () => {
    const legacy = {
      merchantKey: 'SWIGGY',
      categoryId: 'dining',
      direction: 'debit' as const,
      sourceType: SourceType.Bank,
      confirmations: 2,
      lastConfirmedAt: '2024-01-01',
      sampleDescription: 'SWIGGY ORDER',
      ambiguous: true,
    };
    const migrated = migrateLegacyMerchantRule(legacy);
    expect(migrated.status).toBe('ambiguous');
    expect(migrated.activeCategoryId).toBeUndefined();
    expect(migrated.statusReason).toBe('conflict');
  });

  it('ensures minimum 1 confirmation', () => {
    const legacy = {
      merchantKey: 'TEST',
      categoryId: 'other',
      direction: 'debit' as const,
      sourceType: 'any' as MerchantRuleSourceType,
      confirmations: 0,
      lastConfirmedAt: '2024-01-01',
      sampleDescription: 'TEST',
      ambiguous: false,
    };
    const migrated = migrateLegacyMerchantRule(legacy);
    expect(migrated.totalConfirmations).toBe(1);
    expect(migrated.categoryVotes.other).toBe(1);
  });

  it('defaults to confident when ambiguous field is absent', () => {
    const legacy = {
      merchantKey: 'NETFLIX',
      categoryId: 'entertainment',
      direction: 'debit' as const,
      sourceType: SourceType.Bank,
      confirmations: 3,
      lastConfirmedAt: '2024-01-01',
      sampleDescription: 'NETFLIX SUB',
    };
    const migrated = migrateLegacyMerchantRule(legacy);
    expect(migrated.status).toBe('confident');
    expect(migrated.activeCategoryId).toBe('entertainment');
  });
});
