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

    it('migrates legacy-format rules from localStorage on rehydration', async () => {
      // Legacy rule format has `categoryId` + `confirmations` but no `categoryVotes` or `totalConfirmations`
      const legacyRule = {
        merchantKey: 'LEGACY_MERCHANT',
        categoryId: 'shopping',
        direction: 'debit',
        sourceType: 'bank',
        confirmations: 5,
        lastConfirmedAt: '2024-03-15T10:00:00.000Z',
        sampleDescription: 'Payment to LEGACY_MERCHANT',
      };

      const modernRule = makeRule('MODERN_MERCHANT', {
        lastConfirmedAt: '2024-04-01T10:00:00.000Z',
      });

      const persisted = {
        state: {
          rules: [legacyRule, modernRule],
        },
        version: 0,
      };

      localStorage.setItem('merchant-rule-storage', JSON.stringify(persisted));

      // Re-import the store to trigger persist migrate
      const { useMerchantRuleStore: freshStore } = await import('@/lib/store/merchantRuleStore?' + Date.now());

      const rules = freshStore.getState().rules;
      expect(rules.length).toBe(2);

      // Legacy rule should be migrated to new format
      const migrated = rules.find((r: MerchantRule) => r.merchantKey === 'LEGACY_MERCHANT');
      expect(migrated).toBeDefined();
      expect(migrated!.activeCategoryId).toBe('shopping');
      expect(migrated!.categoryVotes).toEqual({ shopping: 5 });
      expect(migrated!.totalConfirmations).toBe(5);
      expect(migrated!.status).toBe('confident');

      // Modern rule should be unchanged
      const modern = rules.find((r: MerchantRule) => r.merchantKey === 'MODERN_MERCHANT');
      expect(modern).toBeDefined();
      expect(modern!.activeCategoryId).toBe('groceries');

      // Clean up
      localStorage.removeItem('merchant-rule-storage');
    });
  });

  describe('sortAndTrimRules trim boundary', () => {
    it('exactly 1000 rules are kept when 1001 exist after upsert', () => {
      // Create 1000 rules with incrementing timestamps so sort is deterministic
      const manyRules: MerchantRule[] = Array.from({ length: 1000 }, (_, i) =>
        makeRule(`RULE_${String(i).padStart(4, '0')}`, {
          lastConfirmedAt: new Date(2024, 0, 1 + i).toISOString(),
          totalConfirmations: 1,
        }),
      );
      useMerchantRuleStore.setState({ rules: manyRules });

      // Adding one more via upsert triggers sortAndTrimRules
      useMerchantRuleStore.getState().upsertRule(makeDecision('EXTRA_RULE'));

      const rules = useMerchantRuleStore.getState().rules;
      expect(rules).toHaveLength(1000);

      // The newest rule (EXTRA_RULE) should be present (it has the most recent lastConfirmedAt)
      const extra = rules.find(r => r.merchantKey === 'EXTRA_RULE');
      expect(extra).toBeDefined();

      // The oldest rule (RULE_0000 with date 2024-01-01) should have been trimmed
      // since all other rules have later dates (RULE_0001=Jan 2, ..., RULE_0999=Oct 27)
      const oldest = rules.find(r => r.merchantKey === 'RULE_0000');
      expect(oldest).toBeUndefined();
    });
  });
});
