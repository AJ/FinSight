import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  enrichImportedTransactions,
  recategorizeStoredTransactions,
  mergeRecategorizedTransactions,
} from '@/lib/services/transactionEnrichmentService';
import { makeTransaction, makeCategory } from '@tests/unit/factories';

// Mock fetch — the only external boundary (LLM HTTP calls go through here)
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── Helpers ────────────────────────────────────────────────────────────────────

function categorizationResponse(results: Array<{ id: string; category: string; confidence: number }>) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({
      response: JSON.stringify(results),
      prompt_eval_count: 10,
      eval_count: 20,
    }),
    text: () => Promise.resolve(JSON.stringify({ response: JSON.stringify(results) })),
  });
}

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('enrichImportedTransactions', () => {
  it('returns empty array for empty input', async () => {
    const result = await enrichImportedTransactions([], {
      provider: 'ollama', baseUrl: 'http://localhost', model: 'llama3',
    });

    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('normalizes merchant names and applies AI categorization', async () => {
    const tx = makeTransaction({ description: 'AMAZON RETAIL' });
    mockFetch.mockResolvedValue(categorizationResponse([
      { id: tx.id, category: 'shopping', confidence: 0.9 },
    ]));

    const result = await enrichImportedTransactions([tx], {
      provider: 'ollama', baseUrl: 'http://localhost:11434', model: 'llama3',
    });

    expect(result).toHaveLength(1);
    // Merchant normalized: AMAZON RETAIL → Amazon (dictionary match)
    expect(result[0].merchant).toBe('Amazon');
    // Category applied from LLM result
    expect(result[0].category.id).toBe('shopping');
    expect(result[0].categoryConfidence).toBe(0.9);
    expect(result[0].categorizedBy).toBe('ai');
  });
});

describe('recategorizeStoredTransactions', () => {
  it('returns empty array for empty input', async () => {
    const result = await recategorizeStoredTransactions([], {
      provider: 'ollama', baseUrl: 'http://localhost', model: 'llama3',
    });

    expect(result).toEqual([]);
  });

  it('normalizes merchants and applies AI categorization', async () => {
    const tx = makeTransaction({ description: 'SWIGGY ORDER' });
    mockFetch.mockResolvedValue(categorizationResponse([
      { id: tx.id, category: 'dining', confidence: 0.85 },
    ]));

    const result = await recategorizeStoredTransactions([tx], {
      provider: 'ollama', baseUrl: 'http://localhost:11434', model: 'llama3',
    });

    expect(result).toHaveLength(1);
    expect(result[0].merchant).toBe('Swiggy');
    expect(result[0].category.id).toBe('dining');
    expect(result[0].categoryConfidence).toBe(0.85);
  });
});

describe('mergeRecategorizedTransactions', () => {
  it('replaces matching transactions by id', () => {
    const original = makeTransaction({ id: 't1', description: 'old' });
    const updated = makeTransaction({ id: 't1', description: 'new' });

    const result = mergeRecategorizedTransactions([original], [updated]);

    expect(result).toHaveLength(1);
    expect(result[0].description).toBe('new');
  });

  it('preserves non-matching transactions', () => {
    const original1 = makeTransaction({ id: 't1', description: 'keep' });
    const original2 = makeTransaction({ id: 't2', description: 'keep2' });
    const updated = makeTransaction({ id: 't1', description: 'updated' });

    const result = mergeRecategorizedTransactions([original1, original2], [updated]);

    expect(result).toHaveLength(2);
    expect(result.find((t) => t.id === 't2')!.description).toBe('keep2');
  });

  it('returns original when no overlap', () => {
    const original = makeTransaction({ id: 't1' });
    const updated = makeTransaction({ id: 't2' });

    const result = mergeRecategorizedTransactions([original], [updated]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('t1');
  });

  // ── Gap coverage ──────────────────────────────────────────────────────────────

  it('falls back to description for merchant normalization when merchant is not set', async () => {
    // Transaction with no merchant set — description used for normalization
    const tx = makeTransaction({ description: 'AMAZON RETAIL' });
    // merchant is undefined by default from makeTransaction
    mockFetch.mockResolvedValue(categorizationResponse([
      { id: tx.id, category: 'shopping', confidence: 0.9 },
    ]));

    const result = await enrichImportedTransactions([tx], {
      provider: 'ollama', baseUrl: 'http://localhost:11434', model: 'llama3',
    });

    expect(result).toHaveLength(1);
    // Merchant was set by normalizing "AMAZON RETAIL" (from description) → "Amazon"
    expect(result[0].merchant).toBe('Amazon');
  });

  it('propagates error when model is missing', async () => {
    const tx = makeTransaction({ description: 'SOME PURCHASE' });

    await expect(
      enrichImportedTransactions([tx], {
        provider: 'ollama', baseUrl: 'http://localhost:11434',
      }),
    ).rejects.toThrow('AI categorization requires a model');
  });

  it('returns normalized transactions unchanged when categorizeTransactions returns empty', async () => {
    // Transfer category is in the NON_CATEGORIZABLE set, so categorizeTransactions
    // returns empty results — transactions are returned with merchant normalized
    // but category unchanged.
    const tx = makeTransaction({
      description: 'AMAZON RETAIL',
      category: makeCategory('transfer'),
    });

    const result = await enrichImportedTransactions([tx], {
      provider: 'ollama', baseUrl: 'http://localhost:11434', model: 'llama3',
    });

    expect(result).toHaveLength(1);
    expect(result[0].merchant).toBe('Amazon');
    // Category stays as transfer (unchanged by AI)
    expect(result[0].category.id).toBe('transfer');
  });

  it('mergeRecategorizedTransactions handles multiple matching originals', () => {
    const original1 = makeTransaction({ id: 't1', description: 'old1' });
    const original2 = makeTransaction({ id: 't2', description: 'old2' });
    const original3 = makeTransaction({ id: 't3', description: 'old3' });
    const updated1 = makeTransaction({ id: 't1', description: 'new1' });
    const updated2 = makeTransaction({ id: 't2', description: 'new2' });

    const result = mergeRecategorizedTransactions(
      [original1, original2, original3],
      [updated1, updated2],
    );

    expect(result).toHaveLength(3);
    expect(result.find((t) => t.id === 't1')!.description).toBe('new1');
    expect(result.find((t) => t.id === 't2')!.description).toBe('new2');
    expect(result.find((t) => t.id === 't3')!.description).toBe('old3');
  });
});
