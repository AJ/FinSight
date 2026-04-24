import { describe, it, expect } from 'vitest';
import { buildTransactionsPrompt } from '@/lib/parsers/extractTransactions';

describe('buildTransactionsPrompt', () => {
  it('returns CC transaction prompt', () => {
    const result = buildTransactionsPrompt('raw text', 'credit_card');
    expect(result).toContain('raw text');
    expect(result).toContain('transactionSubType');
    expect(result.length).toBeGreaterThan(100);
  });

  it('returns bank transaction prompt', () => {
    const result = buildTransactionsPrompt('raw text', 'bank');
    expect(result).toContain('raw text');
    expect(result).toContain('debit');
    expect(result.length).toBeGreaterThan(100);
  });

  it('includes bank name in context', () => {
    const result = buildTransactionsPrompt('raw text', 'bank', 'HDFC');
    expect(result).toContain('HDFC');
  });
});
