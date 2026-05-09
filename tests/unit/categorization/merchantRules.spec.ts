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
});

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
});
