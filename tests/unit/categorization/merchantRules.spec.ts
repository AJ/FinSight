import { describe, it, expect } from 'vitest';
import { buildMerchantKey, findMatchingMerchantRule, applyMerchantRuleDecision, type MerchantRule } from '@/lib/categorization/merchantRules';
import { SourceType } from '@/types';

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
