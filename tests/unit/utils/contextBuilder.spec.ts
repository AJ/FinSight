import { describe, it, expect, vi } from 'vitest';

// Mock date-fns
vi.mock('date-fns', () => ({
  format: vi.fn((date: Date) => date.toISOString()),
}));

import { buildChatContextForQuestion } from '@/lib/chat/contextBuilder';
import { makeTransaction } from '@tests/unit/factories';

describe('buildChatContextForQuestion', () => {
  it('includes ledger snapshot for broad query', () => {
    const txns = [makeTransaction({ amount: 1000 }), makeTransaction({ amount: 2000 })];
    const context = buildChatContextForQuestion(txns, { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, 'What is my spending?');
    expect(context).toContain('Ledger snapshot');
    expect(context).toContain('Transactions: 2');
  });

  it('includes relevant transactions for specific query', () => {
    const txns = [
      makeTransaction({ id: '1', description: 'AMAZON PURCHASE', amount: 1299 }),
      makeTransaction({ id: '2', description: 'SWIGGY FOOD', amount: 350 }),
    ];
    const context = buildChatContextForQuestion(txns, { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, 'How much on Amazon?');
    expect(context).toContain('Ledger');
  });

  it('truncates to maxChars', () => {
    const txns = Array.from({ length: 100 }, (_, i) =>
      makeTransaction({ id: `t${i}`, description: `Transaction ${i}`, amount: 100 + i })
    );
    const context = buildChatContextForQuestion(txns, { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, 'Show recent transactions', { maxChars: 1000 });
    expect(context.length).toBeLessThanOrEqual(1000);
  });

  it('returns context for no transactions', () => {
    const context = buildChatContextForQuestion([], { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, 'What is my spending?');
    expect(context.length).toBeGreaterThan(0);
  });

  it('handles follow-up query', () => {
    const txns = [makeTransaction({ amount: 1000 })];
    const context = buildChatContextForQuestion(txns, { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, 'And what about Amazon?');
    expect(context).toContain('Ledger');
  });
});
