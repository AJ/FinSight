import { describe, it, expect } from 'vitest';

import { applyCategorizationResults, categorizeByKeywords } from '@/lib/categorization/aiCategorizer';
import { CategorizedBy } from '@/types';
import { makeTransaction } from '@tests/unit/factories';

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
