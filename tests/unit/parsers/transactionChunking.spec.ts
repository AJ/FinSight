import { describe, it, expect } from 'vitest';
import {
  createTransactionChunkPlan,
  mergeChunkTransactions,
  getDroppedTransactionCount,
} from '@/lib/parsers/transactionChunking';
import type { ExtractedTransaction } from '@/types/extractedTransaction';

const CHUNK_OVERLAP_LINE_COUNT = 12;

function makeLines(count: number, lineContent = 'line'): string {
  return Array.from({ length: count }, (_, i) => `${lineContent} ${i}`).join('\n');
}

function makeTx(
  overrides: Partial<ExtractedTransaction> &
    Pick<ExtractedTransaction, 'date' | 'description' | 'amount' | 'type'>,
): ExtractedTransaction {
  return { ...overrides };
}

describe('createTransactionChunkPlan', () => {
  it('returns single-shot when below both thresholds', () => {
    const text = makeLines(10);
    const plan = createTransactionChunkPlan(text);

    expect(plan.chunkingUsed).toBe(false);
    expect(plan.chunkTriggerReason).toBe('single_shot');
    expect(plan.normalizedLineCount).toBe(10);
    expect(plan.chunks).toHaveLength(1);
    expect(plan.chunks[0].isFirst).toBe(true);
    expect(plan.chunks[0].isLast).toBe(true);
    expect(plan.chunks[0].overlapStartLine).toBeNull();
    expect(plan.chunks[0].text).toBe(text);
  });

  it('returns single-shot for empty string', () => {
    const plan = createTransactionChunkPlan('');

    expect(plan.chunkingUsed).toBe(false);
    expect(plan.normalizedLineCount).toBe(1);
    expect(plan.normalizedTextLength).toBe(0);
  });

  it('triggers on char threshold only', () => {
    const charLine = 'a'.repeat(130);
    const text = Array.from({ length: 100 }, (_, i) => `${charLine}${i}`).join('\n');

    const plan = createTransactionChunkPlan(text);

    expect(plan.chunkingUsed).toBe(true);
    expect(plan.chunkTriggerReason).toBe('char_threshold');
    expect(plan.normalizedTextLength).toBeGreaterThan(12000);
    expect(plan.normalizedLineCount).toBeLessThanOrEqual(250);
  });

  it('triggers on line threshold only', () => {
    const text = makeLines(260, 'x');

    const plan = createTransactionChunkPlan(text);

    expect(plan.chunkingUsed).toBe(true);
    expect(plan.chunkTriggerReason).toBe('line_threshold');
    expect(plan.normalizedLineCount).toBeGreaterThan(250);
    expect(plan.normalizedTextLength).toBeLessThanOrEqual(12000);
  });

  it('triggers on both thresholds', () => {
    const text = makeLines(260, 'b'.repeat(55));

    const plan = createTransactionChunkPlan(text);

    expect(plan.chunkingUsed).toBe(true);
    expect(plan.chunkTriggerReason).toBe('char_and_line_threshold');
  });

  it('creates correct chunk boundaries for 300 lines', () => {
    const text = makeLines(300);
    const plan = createTransactionChunkPlan(text);

    expect(plan.chunks).toHaveLength(2);
    expect(plan.chunks[0].startLine).toBe(0);
    expect(plan.chunks[0].endLine).toBe(179);
    expect(plan.chunks[1].startLine).toBe(168);
    expect(plan.chunks[1].endLine).toBe(299);
  });

  it('sets isFirst/isLast flags correctly', () => {
    const text = makeLines(400);
    const plan = createTransactionChunkPlan(text);

    expect(plan.chunks).toHaveLength(3);
    expect(plan.chunks[0].isFirst).toBe(true);
    expect(plan.chunks[0].isLast).toBe(false);
    expect(plan.chunks[1].isFirst).toBe(false);
    expect(plan.chunks[1].isLast).toBe(false);
    expect(plan.chunks[2].isFirst).toBe(false);
    expect(plan.chunks[2].isLast).toBe(true);
  });

  it('sets overlapStartLine null for first chunk, startLine for rest', () => {
    const text = makeLines(400);
    const plan = createTransactionChunkPlan(text);

    expect(plan.chunks[0].overlapStartLine).toBeNull();
    for (let i = 1; i < plan.chunks.length; i++) {
      expect(plan.chunks[i].overlapStartLine).toBe(plan.chunks[i].startLine);
    }
  });

  it('consecutive chunks overlap by 12 lines', () => {
    const text = makeLines(400);
    const plan = createTransactionChunkPlan(text);

    for (let i = 0; i < plan.chunks.length - 1; i++) {
      const tail = plan.chunks[i].text.split('\n').slice(-CHUNK_OVERLAP_LINE_COUNT);
      const head = plan.chunks[i + 1].text.split('\n').slice(0, CHUNK_OVERLAP_LINE_COUNT);
      expect(tail).toEqual(head);
    }
  });

  it('totalChunks is consistent across all chunks', () => {
    const text = makeLines(400);
    const plan = createTransactionChunkPlan(text);

    for (const chunk of plan.chunks) {
      expect(chunk.totalChunks).toBe(plan.chunks.length);
    }
  });

  it('covers entire input end-to-end', () => {
    const text = makeLines(300);
    const plan = createTransactionChunkPlan(text);

    expect(plan.chunks[0].startLine).toBe(0);
    expect(plan.chunks[plan.chunks.length - 1].endLine).toBe(plan.normalizedLineCount - 1);
  });
});

describe('mergeChunkTransactions', () => {
  it('returns empty for empty input', () => {
    const result = mergeChunkTransactions([]);
    expect(result.transactions).toEqual([]);
    expect(result.duplicatesRemoved).toBe(0);
  });

  it('preserves all unique transactions', () => {
    const txns = [
      makeTx({ date: '2024-01-01', description: 'Grocery', amount: 50, type: 'debit' }),
      makeTx({ date: '2024-01-02', description: 'Salary', amount: 3000, type: 'credit' }),
    ];

    const result = mergeChunkTransactions(txns);

    expect(result.transactions).toHaveLength(2);
    expect(result.duplicatesRemoved).toBe(0);
  });

  it('deduplicates identical transactions keeping higher confidence', () => {
    const txA = makeTx({ date: '2024-01-15', description: 'Amazon', amount: 99.99, type: 'debit', confidence: 0.7 });
    const txB = makeTx({ date: '2024-01-15', description: 'Amazon', amount: 99.99, type: 'debit', confidence: 0.95 });

    const result = mergeChunkTransactions([txA, txB]);

    expect(result.transactions).toHaveLength(1);
    expect(result.duplicatesRemoved).toBe(1);
    expect(result.transactions[0].confidence).toBe(0.95);
  });

  it('keeps existing when confidences are equal', () => {
    const txA = makeTx({ date: '2024-01-15', description: 'Amazon', amount: 99.99, type: 'debit', confidence: 0.8, balance: 100 });
    const txB = makeTx({ date: '2024-01-15', description: 'Amazon', amount: 99.99, type: 'debit', confidence: 0.8, balance: 200 });

    const result = mergeChunkTransactions([txA, txB]);

    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].balance).toBe(100);
  });

  it('treats missing confidence as -1', () => {
    const txA = makeTx({ date: '2024-01-15', description: 'Amazon', amount: 99.99, type: 'debit' });
    const txB = makeTx({ date: '2024-01-15', description: 'Amazon', amount: 99.99, type: 'debit', confidence: 0.5 });

    const result = mergeChunkTransactions([txA, txB]);

    expect(result.transactions[0].confidence).toBe(0.5);
  });

  it('treats different dates as distinct', () => {
    const txns = [
      makeTx({ date: '2024-01-15', description: 'Coffee', amount: 5, type: 'debit' }),
      makeTx({ date: '2024-01-16', description: 'Coffee', amount: 5, type: 'debit' }),
    ];

    expect(mergeChunkTransactions(txns).transactions).toHaveLength(2);
  });

  it('treats different amounts as distinct', () => {
    const txns = [
      makeTx({ date: '2024-01-15', description: 'Amazon', amount: 50, type: 'debit' }),
      makeTx({ date: '2024-01-15', description: 'Amazon', amount: 75, type: 'debit' }),
    ];

    expect(mergeChunkTransactions(txns).transactions).toHaveLength(2);
  });

  it('normalizes description whitespace and case', () => {
    const txA = makeTx({ date: '2024-01-15', description: 'AMAZON   MARKETPLACE', amount: 99.99, type: 'debit' });
    const txB = makeTx({ date: '2024-01-15', description: 'amazon marketplace', amount: 99.99, type: 'debit' });

    expect(mergeChunkTransactions([txA, txB]).duplicatesRemoved).toBe(1);
  });

  it('counts multiple duplicates correctly', () => {
    const base = { date: '2024-01-15', description: 'Amazon', amount: 99.99, type: 'debit' as const };
    const txns = [
      makeTx({ ...base, confidence: 0.5 }),
      makeTx({ ...base, confidence: 0.6 }),
      makeTx({ ...base, confidence: 0.7 }),
      makeTx({ ...base, confidence: 0.95 }),
    ];

    const result = mergeChunkTransactions(txns);

    expect(result.transactions).toHaveLength(1);
    expect(result.duplicatesRemoved).toBe(3);
    expect(result.transactions[0].confidence).toBe(0.95);
  });

  it('treats different originalCurrency as distinct', () => {
    const txA = makeTx({ date: '2024-01-15', description: 'Hotel', amount: 150, type: 'debit', originalCurrency: 'EUR', originalAmount: 140 });
    const txB = makeTx({ date: '2024-01-15', description: 'Hotel', amount: 150, type: 'debit', originalCurrency: 'GBP', originalAmount: 140 });

    expect(mergeChunkTransactions([txA, txB]).transactions).toHaveLength(2);
  });
});

describe('getDroppedTransactionCount', () => {
  it('returns array length', () => {
    expect(getDroppedTransactionCount({ droppedTransactions: [{}, {}] })).toBe(2);
  });

  it('returns 0 for empty array', () => {
    expect(getDroppedTransactionCount({ droppedTransactions: [] })).toBe(0);
  });

  it('returns 0 for null field', () => {
    expect(getDroppedTransactionCount({ droppedTransactions: null })).toBe(0);
  });

  it('returns 0 for missing field', () => {
    expect(getDroppedTransactionCount({})).toBe(0);
  });

  it('returns 0 for null input', () => {
    expect(getDroppedTransactionCount(null)).toBe(0);
  });

  it('returns 0 for non-array truthy value', () => {
    expect(getDroppedTransactionCount({ droppedTransactions: 'oops' })).toBe(0);
  });
});
