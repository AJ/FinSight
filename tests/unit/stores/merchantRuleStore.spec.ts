import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  findMatchingMerchantRule,
  applyMerchantRuleDecision,
  type MerchantRule,
  type MerchantRuleDecision,
  type MerchantRuleMatchInput,
} from '@/lib/categorization/merchantRules';
import { SourceType } from '@/models';

// Mock the merchantRules module
vi.mock('@/lib/categorization/merchantRules', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/categorization/merchantRules')>();
  return {
    ...actual,
    findMatchingMerchantRule: vi.fn(),
    applyMerchantRuleDecision: vi.fn(),
  };
});

import { useMerchantRuleStore } from '@/lib/store/merchantRuleStore';

beforeEach(() => {
  vi.clearAllMocks();
  useMerchantRuleStore.setState({ rules: [] });
});

function makeRule(merchantKey: string, overrides: Partial<MerchantRule> = {}): MerchantRule {
  return {
    merchantKey,
    direction: 'debit',
    sourceType: SourceType.Bank,
    categoryVotes: { groceries: 3 },
    activeCategoryId: 'groceries',
    status: 'confident',
    lastConfirmedAt: '2024-01-15T00:00:00.000Z',
    sampleDescription: `Sample for ${merchantKey}`,
    totalConfirmations: 3,
    ...overrides,
  };
}

function makeDecision(merchantKey: string, categoryId = 'groceries'): MerchantRuleDecision {
  return {
    merchantKey,
    categoryId,
    direction: 'debit',
    sourceType: SourceType.Bank,
    sampleDescription: `Payment to ${merchantKey}`,
  };
}

describe('merchantRuleStore', () => {
  describe('getRule', () => {
    it('delegates to findMatchingMerchantRule', () => {
      const rule = makeRule('AMAZON');
      vi.mocked(findMatchingMerchantRule).mockReturnValue(rule);

      const input: MerchantRuleMatchInput = { merchantKey: 'AMAZON', direction: 'debit', sourceType: SourceType.Bank };
      const result = useMerchantRuleStore.getState().getRule(input);

      expect(findMatchingMerchantRule).toHaveBeenCalledWith([], input);
      expect(result).toEqual(rule);
    });

    it('returns undefined when no match found', () => {
      vi.mocked(findMatchingMerchantRule).mockReturnValue(null);
      const result = useMerchantRuleStore.getState().getRule({
        merchantKey: 'UNKNOWN',
        direction: 'debit',
        sourceType: SourceType.Bank,
      });
      expect(result).toBeUndefined();
    });
  });

  describe('upsertRule', () => {
    it('creates new rule via applyMerchantRuleDecision', () => {
      const newRule = makeRule('FLIPKART');
      vi.mocked(applyMerchantRuleDecision).mockReturnValue(newRule);

      useMerchantRuleStore.getState().upsertRule(makeDecision('FLIPKART'));

      expect(applyMerchantRuleDecision).toHaveBeenCalledWith(undefined, expect.anything(), expect.any(String));
      expect(useMerchantRuleStore.getState().rules).toHaveLength(1);
      expect(useMerchantRuleStore.getState().rules[0].merchantKey).toBe('FLIPKART');
    });

    it('updates existing rule when match found', () => {
      const existing = makeRule('AMAZON');
      useMerchantRuleStore.setState({ rules: [existing] });

      const updated = { ...existing, totalConfirmations: 4 };
      vi.mocked(applyMerchantRuleDecision).mockReturnValue(updated);

      useMerchantRuleStore.getState().upsertRule(makeDecision('AMAZON'));

      expect(useMerchantRuleStore.getState().rules).toHaveLength(1);
      expect(useMerchantRuleStore.getState().rules[0].totalConfirmations).toBe(4);
    });

    it('sorts rules by lastConfirmedAt descending', () => {
      const old = makeRule('OLD', { lastConfirmedAt: '2024-01-01T00:00:00.000Z' });
      useMerchantRuleStore.setState({ rules: [old] });

      const newRule = makeRule('NEW', { lastConfirmedAt: '2024-06-01T00:00:00.000Z' });
      vi.mocked(applyMerchantRuleDecision).mockReturnValue(newRule);

      useMerchantRuleStore.getState().upsertRule(makeDecision('NEW'));

      const rules = useMerchantRuleStore.getState().rules;
      expect(rules[0].merchantKey).toBe('NEW');
    });

    it('trims rules to 1000 max', () => {
      const manyRules = Array.from({ length: 1000 }, (_, i) =>
        makeRule(`RULE_${String(i).padStart(4, '0')}`, {
          lastConfirmedAt: new Date(2024, 0, 1).toISOString(),
        }),
      );
      useMerchantRuleStore.setState({ rules: manyRules });

      const newest = makeRule('NEWEST', { lastConfirmedAt: new Date(2024, 6, 1).toISOString() });
      vi.mocked(applyMerchantRuleDecision).mockReturnValue(newest);

      useMerchantRuleStore.getState().upsertRule(makeDecision('NEWEST'));
      expect(useMerchantRuleStore.getState().rules.length).toBeLessThanOrEqual(1000);
    });
  });

  describe('listRules', () => {
    it('returns all rules', () => {
      const rules = [makeRule('A'), makeRule('B')];
      useMerchantRuleStore.setState({ rules });
      expect(useMerchantRuleStore.getState().listRules()).toEqual(rules);
    });

    it('returns empty array when no rules', () => {
      expect(useMerchantRuleStore.getState().listRules()).toEqual([]);
    });
  });
});
