import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  findMerchantRuleForTransaction,
  teachMerchantRuleFromTransaction,
  teachMerchantRulesFromConfirmedTransactions,
} from '@/lib/services/merchantRuleService';
import { makeTransaction, makeCategory } from '@tests/unit/factories';
import { useMerchantRuleStore } from '@/lib/store/merchantRuleStore';
import { CategorizedBy } from '@/types';

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useMerchantRuleStore.setState({ rules: [] });
});

describe('findMerchantRuleForTransaction', () => {
  it('returns undefined when no rules exist', () => {
    const tx = makeTransaction({ description: 'AMAZON PURCHASE' });

    expect(findMerchantRuleForTransaction(tx)).toBeUndefined();
  });

  it('finds a rule after one is learned for the same merchant', () => {
    const teachingTx = makeTransaction({ description: 'AMAZON PURCHASE' });
    teachMerchantRuleFromTransaction(teachingTx);

    // Different transaction, same merchant — both normalize to 'AMAZON' key
    const lookupTx = makeTransaction({ description: 'AMAZON RETAIL' });
    const rule = findMerchantRuleForTransaction(lookupTx);

    expect(rule).toBeDefined();
    expect(rule!.activeCategoryId).toBe('shopping');
  });
});

describe('teachMerchantRuleFromTransaction', () => {
  it('stores a rule and returns true', () => {
    const tx = makeTransaction({
      description: 'NETFLIX SUBSCRIPTION',
      category: makeCategory('entertainment'),
    });

    const result = teachMerchantRuleFromTransaction(tx);

    expect(result).toBe(true);
    const rule = findMerchantRuleForTransaction(tx);
    expect(rule).toBeDefined();
    expect(rule!.activeCategoryId).toBe('entertainment');
  });
});

describe('teachMerchantRulesFromConfirmedTransactions', () => {
  it('learns from category changes with manual categorization', () => {
    const original = makeTransaction({ id: 'tx-1', category: makeCategory('other') });
    const reviewed = makeTransaction({
      id: 'tx-1',
      category: makeCategory('shopping'),
      categorizedBy: CategorizedBy.Manual,
    });

    const count = teachMerchantRulesFromConfirmedTransactions([original], [reviewed]);

    expect(count).toBe(1);
    const rule = findMerchantRuleForTransaction(reviewed);
    expect(rule).toBeDefined();
    expect(rule!.activeCategoryId).toBe('shopping');
  });

  it('skips transactions with no category change', () => {
    const tx = makeTransaction({ id: 'tx-1', categorizedBy: CategorizedBy.Manual });

    const count = teachMerchantRulesFromConfirmedTransactions([tx], [tx]);

    expect(count).toBe(0);
  });

  it('skips transactions not in original list', () => {
    const reviewed = makeTransaction({
      id: 'tx-unknown',
      category: makeCategory('shopping'),
      categorizedBy: CategorizedBy.Manual,
    });

    const count = teachMerchantRulesFromConfirmedTransactions([], [reviewed]);

    expect(count).toBe(0);
  });

  it('skips category changes from non-manual categorization', () => {
    const original = makeTransaction({ id: 'tx-1', category: makeCategory('other') });
    const reviewed = makeTransaction({
      id: 'tx-1',
      category: makeCategory('shopping'),
      categorizedBy: CategorizedBy.AI,
    });

    const count = teachMerchantRulesFromConfirmedTransactions([original], [reviewed]);

    expect(count).toBe(0);
  });

  it('learns from multiple changed transactions', () => {
    const originals = [
      makeTransaction({ id: 'tx-1', description: 'AMAZON', category: makeCategory('other') }),
      makeTransaction({ id: 'tx-2', description: 'NETFLIX', category: makeCategory('other') }),
    ];

    const reviewed = [
      makeTransaction({
        id: 'tx-1',
        description: 'AMAZON',
        category: makeCategory('shopping'),
        categorizedBy: CategorizedBy.Manual,
      }),
      makeTransaction({
        id: 'tx-2',
        description: 'NETFLIX',
        category: makeCategory('entertainment'),
        categorizedBy: CategorizedBy.Manual,
      }),
    ];

    const count = teachMerchantRulesFromConfirmedTransactions(originals, reviewed);

    expect(count).toBe(2);
    expect(findMerchantRuleForTransaction(reviewed[0])?.activeCategoryId).toBe('shopping');
    expect(findMerchantRuleForTransaction(reviewed[1])?.activeCategoryId).toBe('entertainment');
  });
});
