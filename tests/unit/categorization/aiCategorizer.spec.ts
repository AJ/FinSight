import { describe, it, expect, vi, beforeEach } from 'vitest';

import { applyCategorizationResults, categorizeByKeywords, categorizeTransactions, batchTransactions } from '@/lib/categorization/aiCategorizer';
import { CategorizedBy } from '@/types';
import { makeTransaction } from '@tests/unit/factories';
import '@/lib/categorization/categories';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('categorizeByKeywords (re-exported)', () => {
  it('returns shopping for Amazon descriptions', () => {
    const result = categorizeByKeywords({ description: 'AMAZON PURCHASE', amount: 1299, type: 'debit' });
    expect(result).toBe('shopping');
  });

  it('returns other for unknown merchant', () => {
    const result = categorizeByKeywords({ description: 'XYZ UNKNOWN MERCHANT', amount: 500, type: 'debit' });
    expect(result).toBe('other');
  });
});

describe('applyCategorizationResults', () => {
  it('preserves existing metadata', () => {
    const original = makeTransaction({ id: '1' });
    const results = [{ id: '1', category: 'dining', confidence: 0.9, source: 'ai' as const }];
    const updated = applyCategorizationResults([original], results);
    expect(updated[0].description).toBe('Test Transaction');
    expect(updated[0].amount).toBe(100);
  });

  it('skips transactions not in results', () => {
    const txns = [makeTransaction({ id: '1' }), makeTransaction({ id: '2' })];
    const results = [{ id: '1', category: 'dining', confidence: 0.9, source: 'ai' as const }];
    const updated = applyCategorizationResults(txns, results);
    expect(updated[1].category.id).toBe('shopping'); // Unchanged
  });

  it('keeps original category for unknown category ID', () => {
    const txns = [makeTransaction({ id: '1' })];
    const results = [{ id: '1', category: 'nonexistent_category', confidence: 0.9, source: 'ai' as const }];
    const updated = applyCategorizationResults(txns, results);
    // Category.fromId returns null for unknown IDs → falls back to original
    expect(updated[0].category.id).toBe('shopping');
  });

  it('sets categoryConfidence from result', () => {
    const txns = [makeTransaction({ id: '1' })];
    const results = [{ id: '1', category: 'dining', confidence: 0.85, source: 'ai' as const }];
    const updated = applyCategorizationResults(txns, results);
    expect(updated[0].categoryConfidence).toBe(0.85);
  });

  it('sets categorizedBy based on source', () => {
    const txns = [makeTransaction({ id: '1' })];
    const results = [{ id: '1', category: 'dining', confidence: 0.9, source: 'ai' as const }];
    const updated = applyCategorizationResults(txns, results);
    expect(updated[0].categorizedBy).toBe(CategorizedBy.AI);
  });
});

describe('batchTransactions', () => {
  it('splits transactions into batches', () => {
    const txns = Array.from({ length: 30 }, (_, i) =>
      makeTransaction({ id: String(i), description: `Transaction ${i}` })
    );
    const batches = batchTransactions(txns, 10);
    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(10);
  });

  it('handles transactions fewer than batch size', () => {
    const txns = [makeTransaction({ id: '1' }), makeTransaction({ id: '2' })];
    const batches = batchTransactions(txns, 10);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
  });
});

describe('categorizeTransactions', () => {
  function ollamaResponse(response: string) {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        response,
        prompt_eval_count: 10,
        eval_count: 20,
      }),
      text: () => Promise.resolve(JSON.stringify({ response })),
    });
  }

  it('returns empty for no transactions', async () => {
    const results = await categorizeTransactions([], {
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'llama3',
    });
    expect(results).toEqual([]);
  });

  it('throws when model is missing', async () => {
    const txns = [makeTransaction({ id: '1' })];
    await expect(categorizeTransactions(txns, {
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: '',
    })).rejects.toThrow('model');
  });

  it('uses LLM for transactions without merchant rules', async () => {
    mockFetch.mockResolvedValue(ollamaResponse(JSON.stringify([{
      id: '1',
      category: 'groceries',
      confidence: 0.9,
      source: 'ai',
    }])));

    const txns = [makeTransaction({ id: '1', description: 'MYSTORE GROCERY' })];
    const results = await categorizeTransactions(txns, {
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'llama3',
    });

    expect(results.length).toBeGreaterThan(0);
    expect(mockFetch).toHaveBeenCalled();
  });
});
