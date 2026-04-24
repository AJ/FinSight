import { describe, it, expect } from 'vitest';
import {
  buildCategorizationPrompt,
  parseCategorizationResponse,
  normalizeCategoryId,
} from '@/lib/categorization/prompts';

describe('buildCategorizationPrompt', () => {
  it('includes all transaction descriptions', () => {
    const txns = [
      { id: '1', description: 'AMAZON', amount: 1299, type: 'debit' as const },
      { id: '2', description: 'SWIGGY', amount: 350, type: 'debit' as const },
      { id: '3', description: 'SALARY', amount: 50000, type: 'credit' as const },
    ];
    const result = buildCategorizationPrompt(txns);
    expect(result).toContain('AMAZON');
    expect(result).toContain('SWIGGY');
    expect(result).toContain('SALARY');
  });

  it('includes statement type context for credit card', () => {
    const txns = [{ id: '1', description: 'AMAZON', amount: 1299, type: 'debit' as const }];
    const result = buildCategorizationPrompt(txns, 'credit_card');
    expect(result).toContain('Credit Card');
  });

  it('includes statement type context for bank', () => {
    const txns = [{ id: '1', description: 'AMAZON', amount: 1299, type: 'debit' as const }];
    const result = buildCategorizationPrompt(txns, 'bank');
    expect(result).toContain('Bank');
  });

  it('includes all category IDs in system prompt', () => {
    const txns = [{ id: '1', description: 'AMAZON', amount: 1299, type: 'debit' as const }];
    const result = buildCategorizationPrompt(txns);
    expect(result).toContain('"groceries"');
    expect(result).toContain('"dining"');
    expect(result).toContain('"shopping"');
  });
});

describe('parseCategorizationResponse', () => {
  it('parses valid JSON array', () => {
    const response = JSON.stringify([{ id: '1', category: 'dining', confidence: 0.9 }]);
    const result = parseCategorizationResponse(response);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('dining');
    expect(result[0].confidence).toBe(0.9);
    expect(result[0].source).toBe('ai');
  });

  it('parses markdown code block', () => {
    const response = '```json\n[{"id":"1","category":"dining","confidence":0.9}]\n```';
    const result = parseCategorizationResponse(response);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('dining');
  });

  it('fixes trailing commas', () => {
    const response = '[{"id":"1","category":"dining",}]';
    const result = parseCategorizationResponse(response);
    expect(result).toHaveLength(1);
  });

  it('returns empty on total failure', () => {
    const response = 'not json at all';
    expect(parseCategorizationResponse(response)).toEqual([]);
  });

  it('normalizes category aliases', () => {
    const response = JSON.stringify([{ id: '1', category: 'bill_payment', confidence: 0.9 }]);
    const result = parseCategorizationResponse(response);
    expect(result[0].category).toBe('bills');
  });

  it('maps invalid categories to other', () => {
    // normalizeCategoryId maps unknown categories to 'other' which IS valid
    const response = JSON.stringify([{ id: '1', category: 'nonexistent_cat', confidence: 0.9 }]);
    const result = parseCategorizationResponse(response);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('other');
  });

  it('defaults to 0.2 confidence when missing', () => {
    const response = JSON.stringify([{ id: '1', category: 'other' }]);
    const result = parseCategorizationResponse(response);
    expect(result[0].confidence).toBe(0.2);
  });
});

describe('normalizeCategoryId', () => {
  it('returns canonical ID for valid category', () => {
    expect(normalizeCategoryId('groceries')).toBe('groceries');
    expect(normalizeCategoryId('dining')).toBe('dining');
    expect(normalizeCategoryId('shopping')).toBe('shopping');
  });

  it('maps alias to canonical', () => {
    expect(normalizeCategoryId('bill_payment')).toBe('bills');
    expect(normalizeCategoryId('salary')).toBe('income');
    expect(normalizeCategoryId('crypto')).toBe('investment');
  });

  it('maps partial alias', () => {
    expect(normalizeCategoryId('insurance_payment')).toBe('insurance');
  });

  it('returns other for unknown category', () => {
    expect(normalizeCategoryId('completely_made_up')).toBe('other');
  });

  it('is case-insensitive', () => {
    expect(normalizeCategoryId('BILL_PAYMENT')).toBe('bills');
    expect(normalizeCategoryId('Dining')).toBe('dining');
  });

  it('handles whitespace', () => {
    expect(normalizeCategoryId('  groceries  ')).toBe('groceries');
  });

  it('normalizes underscores and hyphens', () => {
    expect(normalizeCategoryId('bill-pay')).toBe('bills');
  });
});
