import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type Transaction, CategorizedBy } from '@/types';
import { makeCategory, type makeTransaction } from '@tests/unit/factories';
import { CategoryType } from '@/models';

const mockGetRule = vi.fn();
const mockUpsertRule = vi.fn();

vi.mock('@/lib/store/merchantRuleStore', () => ({
  useMerchantRuleStore: {
    getState: () => ({
      getRule: mockGetRule,
      upsertRule: mockUpsertRule,
    }),
  },
}));

const mockGetMerchantRuleInput = vi.fn();
const mockGetMerchantRuleDecision = vi.fn();

vi.mock('@/lib/categorization/merchantRules', () => ({
  getMerchantRuleInput: (...args: unknown[]) => mockGetMerchantRuleInput(...args),
  getMerchantRuleDecision: (...args: unknown[]) => mockGetMerchantRuleDecision(...args),
}));

import {
  findMerchantRuleForTransaction,
  teachMerchantRuleFromTransaction,
  teachMerchantRulesFromConfirmedTransactions,
} from '@/lib/services/merchantRuleService';

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    date: new Date('2024-01-15'),
    description: 'Amazon Purchase',
    amount: 99.99,
    type: 'debit' as const,
    category: makeCategory('shopping'),
    balance: 1000,
    isDebit: true,
    isCredit: false,
    categorizedBy: CategorizedBy.Manual,
    sourceType: 'bank',
    ...overrides,
  } as Transaction;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('findMerchantRuleForTransaction', () => {
  it('delegates to store with rule input', () => {
    mockGetMerchantRuleInput.mockReturnValue('amazon');
    mockGetRule.mockReturnValue({ category: 'shopping' });

    const tx = makeTx();
    const result = findMerchantRuleForTransaction(tx);

    expect(mockGetMerchantRuleInput).toHaveBeenCalledWith(tx);
    expect(mockGetRule).toHaveBeenCalledWith('amazon');
    expect(result).toEqual({ category: 'shopping' });
  });

  it('returns undefined when no rule found', () => {
    mockGetMerchantRuleInput.mockReturnValue('unknown_merchant');
    mockGetRule.mockReturnValue(undefined);

    expect(findMerchantRuleForTransaction(makeTx())).toBeUndefined();
  });
});

describe('teachMerchantRuleFromTransaction', () => {
  it('returns false when no decision can be made', () => {
    mockGetMerchantRuleDecision.mockReturnValue(null);

    expect(teachMerchantRuleFromTransaction(makeTx())).toBe(false);
    expect(mockUpsertRule).not.toHaveBeenCalled();
  });

  it('upserts rule and returns true when decision exists', () => {
    const decision = { merchant: 'amazon', categoryId: 'shopping' };
    mockGetMerchantRuleDecision.mockReturnValue(decision);
    mockUpsertRule.mockReturnValue(undefined);

    expect(teachMerchantRuleFromTransaction(makeTx())).toBe(true);
    expect(mockUpsertRule).toHaveBeenCalledWith(decision);
  });
});

describe('teachMerchantRulesFromConfirmedTransactions', () => {
  it('learns from category changes with manual categorization', () => {
    const original = makeTx({
      id: 'tx-1',
      category: makeCategory('other'),
    });

    const reviewed = makeTx({
      id: 'tx-1',
      category: makeCategory('shopping'),
      categorizedBy: CategorizedBy.Manual,
    });

    mockGetMerchantRuleDecision.mockReturnValue({ merchant: 'amazon', categoryId: 'shopping' });

    const count = teachMerchantRulesFromConfirmedTransactions([original], [reviewed]);

    expect(count).toBe(1);
    expect(mockGetMerchantRuleDecision).toHaveBeenCalledTimes(1);
  });

  it('skips transactions with matching IDs but no category change', () => {
    const tx = makeTx({ id: 'tx-1', categorizedBy: CategorizedBy.Manual });

    const count = teachMerchantRulesFromConfirmedTransactions([tx], [tx]);

    expect(count).toBe(0);
    expect(mockGetMerchantRuleDecision).not.toHaveBeenCalled();
  });

  it('skips transactions not in original list', () => {
    const reviewed = makeTx({
      id: 'tx-unknown',
      category: makeCategory('shopping'),
      categorizedBy: CategorizedBy.Manual,
    });

    const count = teachMerchantRulesFromConfirmedTransactions([], [reviewed]);

    expect(count).toBe(0);
  });

  it('skips category changes from non-manual categorization', () => {
    const original = makeTx({
      id: 'tx-1',
      category: makeCategory('other'),
    });

    const reviewed = makeTx({
      id: 'tx-1',
      category: makeCategory('shopping'),
      categorizedBy: CategorizedBy.AI,
    });

    const count = teachMerchantRulesFromConfirmedTransactions([original], [reviewed]);

    expect(count).toBe(0);
    expect(mockGetMerchantRuleDecision).not.toHaveBeenCalled();
  });

  it('skips when decision returns null', () => {
    const original = makeTx({
      id: 'tx-1',
      category: makeCategory('other'),
    });

    const reviewed = makeTx({
      id: 'tx-1',
      category: makeCategory('shopping'),
      categorizedBy: CategorizedBy.Manual,
    });

    mockGetMerchantRuleDecision.mockReturnValue(null);

    const count = teachMerchantRulesFromConfirmedTransactions([original], [reviewed]);

    expect(count).toBe(0);
  });

  it('learns from multiple changed transactions', () => {
    const originals = [
      makeTx({ id: 'tx-1', category: makeCategory('other') }),
      makeTx({ id: 'tx-2', category: makeCategory('other') }),
    ];

    const reviewed = [
      makeTx({ id: 'tx-1', category: makeCategory('food'), categorizedBy: CategorizedBy.Manual }),
      makeTx({ id: 'tx-2', category: makeCategory('transport'), categorizedBy: CategorizedBy.Manual }),
    ];

    mockGetMerchantRuleDecision.mockReturnValue({ merchant: 'test', categoryId: 'test' });

    const count = teachMerchantRulesFromConfirmedTransactions(originals, reviewed);

    expect(count).toBe(2);
  });
});
