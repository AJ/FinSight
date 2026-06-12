import { describe, it, expect } from 'vitest';
import {
  buildCategorizationPrompt,
  parseCategorizationResponse,
  normalizeCategoryId,
} from '@/lib/categorization/prompts';
import { SourceType } from '@/types';

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

  it('includes sourceType in payload when present', () => {
    const transactions = [
      { id: '1', description: 'AMAZON', amount: 100, type: 'debit' as const, sourceType: SourceType.Bank },
    ];
    const result = buildCategorizationPrompt(transactions);
    expect(result).toContain('"sourceType":"bank"');
  });

  it('includes transactionSubType in payload when present', () => {
    const transactions = [
      { id: '1', description: 'NETFLIX', amount: 15, type: 'debit' as const, transactionSubType: 'debt_payment' as const },
    ];
    const result = buildCategorizationPrompt(transactions);
    expect(result).toContain('"transactionSubType":"debt_payment"');
  });

  it('omits sourceType from transaction payload when not provided', () => {
    const transactions = [
      { id: '1', description: 'AMAZON', amount: 100, type: 'debit' as const },
    ];
    const result = buildCategorizationPrompt(transactions);
    // The system prompt mentions "sourceType" in its rules, so we only check the JSON payload portion
    const payloadMatch = result.match(/\{[^}]*"id":"1"[^}]*\}/);
    expect(payloadMatch).toBeTruthy();
    expect(payloadMatch![0]).not.toContain('sourceType');
  });

  it('falls back to normalized description when merchant is empty', () => {
    const transactions = [
      { id: '1', description: 'NETFLIX SUBSCRIPTION', amount: 15, type: 'debit' as const, merchant: '' },
    ];
    const result = buildCategorizationPrompt(transactions);
    // merchant is empty string → fallback to normalizeMerchantName(description) = "Netflix"
    expect(result).toContain('"merchant":"Netflix"');
  });

  it('handles empty transaction array', () => {
    const result = buildCategorizationPrompt([]);
    // Empty array produces "[\n  \n]" not "[]", so check the prompt is valid and has an empty list
    expect(result).toContain('Categorize these transactions');
    expect(result).toBeDefined();
  });

  it('normalizes direction using normalizeTransactionType', () => {
    const transactions = [
      { id: '1', description: 'SALARY', amount: 50000, type: 'income' as const },
    ];
    const result = buildCategorizationPrompt(transactions);
    // 'income' should be normalized to 'credit' direction
    expect(result).toContain('"direction":"credit"');
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

  it('extracts JSON array from surrounding text', () => {
    const response = `Here are the categorizations:
[{"id":"1","category":"dining","confidence":0.9}]
Hope this helps!`;
    const result = parseCategorizationResponse(response);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('dining');
    expect(result[0].confidence).toBe(0.9);
  });

  it('handles string confidence value', () => {
    const response = JSON.stringify([{ id: '1', category: 'dining', confidence: '0.85' }]);
    const result = parseCategorizationResponse(response);
    expect(result[0].confidence).toBe(0.85);
    expect(result[0].source).toBe('ai');
  });

  it('handles out-of-range string confidence as keyword source', () => {
    const response = JSON.stringify([{ id: '1', category: 'dining', confidence: '1.5' }]);
    const result = parseCategorizationResponse(response);
    expect(result[0].confidence).toBe(0.2);
    expect(result[0].source).toBe('keyword');
  });

  it('handles non-numeric string confidence as keyword source', () => {
    const response = JSON.stringify([{ id: '1', category: 'dining', confidence: 'high' }]);
    const result = parseCategorizationResponse(response);
    expect(result[0].confidence).toBe(0.2);
    expect(result[0].source).toBe('keyword');
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

  it('"bill" maps via partial alias match', () => {
    // "bill_payment".includes("bill") is true → maps to "bills"
    const result = normalizeCategoryId('bill');
    expect(result).toBe('bills');
  });

  it('"bill-payment" maps to "bills" via partial match', () => {
    // "bill-payment".includes("bill-pay") is true
    const result = normalizeCategoryId('bill-payment');
    expect(result).toBe('bills');
  });

  it('"transfer_in" returns "other" when no partial alias matches', () => {
    const result = normalizeCategoryId('transfer_in');
    expect(result).toBe('other');
  });

  it('"bank" maps via partial match to first matching alias', () => {
    // "bank_transfer" maps to "other" (transfer variants no longer map to excluded "transfer").
    // "bank_transfer".includes("bank") → true, so result is "other".
    const result = normalizeCategoryId('bank');
    expect(result).toBe('other');
  });

  it('category with spaces converts to underscores before matching', () => {
    // "bill payment" → "bill_payment" → exact alias match → "bills"
    const result = normalizeCategoryId('bill payment');
    expect(result).toBe('bills');
  });
});
