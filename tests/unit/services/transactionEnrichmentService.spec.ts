import { describe, it, expect, vi, beforeEach } from 'vitest';

import { normalizeMerchantName } from '@/lib/categorizer';
import {
  categorizeTransactions,
  applyCategorizationResults,
} from '@/lib/categorization/aiCategorizer';

vi.mock('@/lib/categorizer', () => ({
  normalizeMerchantName: vi.fn((name) => `normalized_${name}`),
}));

vi.mock('@/lib/categorization/aiCategorizer', () => ({
  categorizeTransactions: vi.fn(async () => []),
  applyCategorizationResults: vi.fn((txns) => txns),
}));

import {
  enrichImportedTransactions,
  recategorizeStoredTransactions,
  mergeRecategorizedTransactions,
} from '@/lib/services/transactionEnrichmentService';
import { makeTransaction } from '@tests/unit/factories';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('enrichImportedTransactions', () => {
  it('returns empty array for empty input', async () => {
    const result = await enrichImportedTransactions([], { provider: 'ollama', baseUrl: 'http://localhost', model: 'llama3' });
    expect(result).toEqual([]);
    expect(normalizeMerchantName).not.toHaveBeenCalled();
  });

  it('normalizes merchant names before categorization', async () => {
    const txns = [makeTransaction({ description: 'AMAZON' })];
    await enrichImportedTransactions(txns, { provider: 'ollama', baseUrl: 'http://localhost', model: 'llama3' });

    expect(normalizeMerchantName).toHaveBeenCalledWith('AMAZON');
    expect(categorizeTransactions).toHaveBeenCalled();
  });

  it('applies categorization results', async () => {
    const txns = [makeTransaction({ description: 'NETFLIX' })];
    await enrichImportedTransactions(txns, { provider: 'ollama', baseUrl: 'http://localhost', model: 'llama3' });

    expect(applyCategorizationResults).toHaveBeenCalled();
  });
});

describe('recategorizeStoredTransactions', () => {
  it('returns empty array for empty input', async () => {
    const result = await recategorizeStoredTransactions([], { provider: 'ollama', baseUrl: 'http://localhost', model: 'llama3' });
    expect(result).toEqual([]);
  });

  it('normalizes and recategorizes', async () => {
    const txns = [makeTransaction({ description: 'SWIGGY' })];
    await recategorizeStoredTransactions(txns, { provider: 'ollama', baseUrl: 'http://localhost', model: 'llama3' });

    expect(normalizeMerchantName).toHaveBeenCalled();
    expect(categorizeTransactions).toHaveBeenCalled();
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
});
