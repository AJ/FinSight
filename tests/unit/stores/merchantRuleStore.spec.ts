import { describe, it, expect, beforeEach } from 'vitest';

import { type MerchantRule, type MerchantRuleDecision, type MerchantRuleMatchInput } from '@/lib/categorization/merchantRules';
import { SourceType } from '@/models';

import { useMerchantRuleStore } from '@/lib/store/merchantRuleStore';

beforeEach(() => {
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
    it('finds a matching confident rule', () => {
      const rule = makeRule('AMAZON');
      useMerchantRuleStore.setState({ rules: [rule] });

      const input: MerchantRuleMatchInput = { merchantKey: 'AMAZON', direction: 'debit', sourceType: SourceType.Bank };
      const result = useMerchantRuleStore.getState().getRule(input);

      expect(result).toBeDefined();
      expect(result!.activeCategoryId).toBe('groceries');
    });

    it('returns undefined when no match found', () => {
      const rule = makeRule('AMAZON');
      useMerchantRuleStore.setState({ rules: [rule] });

      const result = useMerchantRuleStore.getState().getRule({
        merchantKey: 'UNKNOWN',
        direction: 'debit',
        sourceType: SourceType.Bank,
      });
      expect(result).toBeUndefined();
    });
  });

  describe('upsertRule', () => {
    it('creates new rule for unknown merchant', () => {
      useMerchantRuleStore.getState().upsertRule(makeDecision('FLIPKART'));

      expect(useMerchantRuleStore.getState().rules).toHaveLength(1);
      expect(useMerchantRuleStore.getState().rules[0].merchantKey).toBe('FLIPKART');
      expect(useMerchantRuleStore.getState().rules[0].activeCategoryId).toBe('groceries');
      expect(useMerchantRuleStore.getState().rules[0].totalConfirmations).toBe(1);
    });

    it('updates existing rule when merchant matches', () => {
      const existing = makeRule('AMAZON');
      useMerchantRuleStore.setState({ rules: [existing] });

      useMerchantRuleStore.getState().upsertRule(makeDecision('AMAZON'));

      expect(useMerchantRuleStore.getState().rules).toHaveLength(1);
      expect(useMerchantRuleStore.getState().rules[0].totalConfirmations).toBe(4);
    });

    it('sorts rules by lastConfirmedAt descending', () => {
      const old = makeRule('OLD', { lastConfirmedAt: '2024-01-01T00:00:00.000Z' });
      useMerchantRuleStore.setState({ rules: [old] });

      useMerchantRuleStore.getState().upsertRule(makeDecision('NEW'));

      const rules = useMerchantRuleStore.getState().rules;
      // NEW was just upserted, so its lastConfirmedAt is now — should be first
      expect(rules[0].merchantKey).toBe('NEW');
    });

    it('trims rules to 1000 max', () => {
      const manyRules = Array.from({ length: 1000 }, (_, i) =>
        makeRule(`RULE_${String(i).padStart(4, '0')}`, {
          lastConfirmedAt: new Date(2024, 0, 1).toISOString(),
        }),
      );
      useMerchantRuleStore.setState({ rules: manyRules });

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

  describe('persist migration', () => {
    it('starts with empty rules after clear', () => {
      const { rules } = useMerchantRuleStore.getState();
      expect(rules).toEqual([]);
    });
  });
});
