import { describe, it, expect, vi } from 'vitest';

// Mock dependencies
vi.mock('@/lib/services/merchantRuleService', () => ({
  findMerchantRuleForTransaction: vi.fn(),
}));

vi.mock('@/lib/llm/index', () => ({
  getBrowserClient: vi.fn(),
}));

// Import categories first
import '@/lib/categorization/categories';

import { applyCategorizationResults, categorizeByKeywords } from '@/lib/categorization/aiCategorizer';
import { Transaction, TransactionType, Category, CategoryType, CategorizedBy } from '@/types';

function makeCategory(id: string): Category {
  return new Category(id, id, CategoryType.Expense);
}

function makeTx(id: string = '1'): Transaction {
  return new Transaction(
    id,
    new Date('2024-01-15'),
    'AMAZON PURCHASE',
    1299,
    TransactionType.Debit,
    makeCategory('shopping'),
    undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined,
  );
}

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
    const original = makeTx('1');
    const results = [{ id: '1', category: 'dining', confidence: 0.9, source: 'ai' as const }];
    const updated = applyCategorizationResults([original], results);
    expect(updated[0].description).toBe('AMAZON PURCHASE');
    expect(updated[0].amount).toBe(1299);
  });

  it('skips transactions not in results', () => {
    const txns = [makeTx('1'), makeTx('2')];
    const results = [{ id: '1', category: 'dining', confidence: 0.9, source: 'ai' as const }];
    const updated = applyCategorizationResults(txns, results);
    expect(updated[1].category.id).toBe('shopping'); // Unchanged
  });

  it('keeps original category for unknown category ID', () => {
    const txns = [makeTx('1')];
    const results = [{ id: '1', category: 'nonexistent_category', confidence: 0.9, source: 'ai' as const }];
    const updated = applyCategorizationResults(txns, results);
    // Category.fromId returns null for unknown IDs → falls back to original
    expect(updated[0].category.id).toBe('shopping');
  });

  it('sets categoryConfidence from result', () => {
    const txns = [makeTx('1')];
    const results = [{ id: '1', category: 'dining', confidence: 0.85, source: 'ai' as const }];
    const updated = applyCategorizationResults(txns, results);
    expect(updated[0].categoryConfidence).toBe(0.85);
  });

  it('sets categorizedBy based on source', () => {
    const txns = [makeTx('1')];
    const results = [{ id: '1', category: 'dining', confidence: 0.9, source: 'ai' as const }];
    const updated = applyCategorizationResults(txns, results);
    expect(updated[0].categorizedBy).toBe(CategorizedBy.AI);
  });
});
