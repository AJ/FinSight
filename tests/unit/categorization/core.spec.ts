import { describe, it, expect, vi } from 'vitest';
import '@/lib/categorization/categories'; // Register categories for real keyword matching

import {
  shouldSkipAICategorization,
  categorizeByKeywords,
  batchTransactions,
  runCategorizationCore,
} from '@/lib/categorization/core';

describe('shouldSkipAICategorization', () => {
  it('skips transfer category', () => {
    expect(shouldSkipAICategorization({ categoryId: 'transfer' })).toBe(true);
  });

  it('skips investment category', () => {
    expect(shouldSkipAICategorization({ categoryId: 'investment' })).toBe(true);
  });

  it('does not skip dining category', () => {
    expect(shouldSkipAICategorization({ categoryId: 'dining' })).toBe(false);
  });

  it('does not skip other category', () => {
    expect(shouldSkipAICategorization({ categoryId: 'other' })).toBe(false);
  });

  it('does not skip when categoryId is null', () => {
    expect(shouldSkipAICategorization({ categoryId: undefined })).toBe(false);
  });

  it('does not skip when categoryId is undefined', () => {
    expect(shouldSkipAICategorization({})).toBe(false);
  });
});

describe('categorizeByKeywords', () => {
  it('categorizes swiggy as dining', () => {
    const result = categorizeByKeywords({ description: 'SWIGGY ORDER', amount: 350, type: 'debit' });
    expect(result).toBe('dining');
  });

  it('categorizes food keyword as groceries (groceries registered before dining)', () => {
    // "food" is a groceries keyword, registered before dining in category order.
    // "SWIGGY FOOD ORDER" matches groceries via "food" before dining's "swiggy" is checked.
    const result = categorizeByKeywords({ description: 'SWIGGY FOOD ORDER', amount: 350, type: 'debit' });
    expect(result).toBe('groceries');
  });

  it('categorizes Amazon as shopping', () => {
    const result = categorizeByKeywords({ description: 'AMAZON IN PURCHASE', amount: 1299, type: 'debit' });
    expect(result).toBe('shopping');
  });

  it('categorizes unknown merchant as other', () => {
    const result = categorizeByKeywords({ description: 'XYZ MERCHANT ABC', amount: 500, type: 'debit' });
    expect(result).toBe('other');
  });

  it('handles empty description', () => {
    const result = categorizeByKeywords({ description: '', amount: 100, type: 'debit' });
    expect(result).toBe('other');
  });
});

describe('batchTransactions', () => {
  it('batches into groups of default size 20', () => {
    const txns = Array.from({ length: 45 }, (_, i) => ({ id: `txn${i}` }));
    const batches = batchTransactions(txns);
    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(20);
    expect(batches[1]).toHaveLength(20);
    expect(batches[2]).toHaveLength(5);
  });

  it('uses custom batch size', () => {
    const txns = Array.from({ length: 10 }, (_, i) => ({ id: `txn${i}` }));
    const batches = batchTransactions(txns, 3);
    expect(batches).toHaveLength(4);
    expect(batches[0]).toHaveLength(3);
    expect(batches[3]).toHaveLength(1);
  });

  it('handles empty array', () => {
    expect(batchTransactions([])).toEqual([]);
  });

  it('handles fewer items than batch size', () => {
    const txns = [{ id: 'a' }, { id: 'b' }];
    const batches = batchTransactions(txns, 10);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
  });
});

describe('runCategorizationCore', () => {
  it('returns empty array for empty input', async () => {
    const result = await runCategorizationCore([], {
      generate: vi.fn(),
    });
    expect(result).toEqual([]);
  });

  it('returns empty array when all transactions are non-categorizable', async () => {
    const result = await runCategorizationCore(
      [{ id: '1', description: 'X', amount: 100, type: 'debit', categoryId: 'transfer' }],
      { generate: vi.fn() },
    );
    expect(result).toEqual([]);
  });

  it('calls LLM generator and parses results', async () => {
    const generate = vi.fn().mockResolvedValue(
      JSON.stringify([{ id: '1', category: 'dining', confidence: 0.9, source: 'ai' }])
    );

    const result = await runCategorizationCore(
      [{ id: '1', description: 'SWIGGY FOOD', amount: 350, type: 'debit' }],
      { generate },
    );

    expect(generate).toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('dining');
    expect(result[0].confidence).toBe(0.9);
    expect(result[0].source).toBe('ai');
  });

  it('falls back to keywords when LLM response has no matching ID', async () => {
    const generate = vi.fn().mockResolvedValue(
      JSON.stringify([{ id: 'wrong-id', category: 'dining', confidence: 0.9, source: 'ai' }])
    );

    const result = await runCategorizationCore(
      [{ id: '1', description: 'AMAZON PURCHASE', amount: 1299, type: 'debit' }],
      { generate },
    );

    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('keyword');
    expect(result[0].confidence).toBe(0.3);
    expect(result[0].category).toBe('shopping'); // Keyword fallback
  });

  it('falls back to keywords when LLM throws', async () => {
    const generate = vi.fn().mockRejectedValue(new Error('LLM connection failed'));

    const result = await runCategorizationCore(
      [{ id: '1', description: 'AMAZON PURCHASE', amount: 1299, type: 'debit' }],
      { generate },
    );

    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('keyword');
    expect(result[0].confidence).toBe(0.3);
  });

  it('calls onProgress callback', async () => {
    const onProgress = vi.fn();
    const generate = vi.fn().mockResolvedValue('[]');

    await runCategorizationCore(
      [{ id: '1', description: 'X', amount: 100, type: 'debit' }],
      { generate, onProgress },
    );

    expect(onProgress).toHaveBeenCalled();
  });
});
