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

  it('does NOT chunk text at exactly the char threshold (12000)', () => {
    // Code uses > not >=, so exactly 12000 chars is single_shot
    const text = 'a'.repeat(12000);
    const plan = createTransactionChunkPlan(text);

    expect(plan.chunkingUsed).toBe(false);
    expect(plan.chunkTriggerReason).toBe('single_shot');
  });

  it('does NOT chunk text at exactly the line threshold (250)', () => {
    // 250 lines means normalizedLineCount = 250, which is NOT > 250
    const text = makeLines(250);
    const plan = createTransactionChunkPlan(text);

    expect(plan.chunkingUsed).toBe(false);
    expect(plan.chunkTriggerReason).toBe('single_shot');
  });

  it('chunks text at 12001 chars', () => {
    const text = 'a'.repeat(12001);
    const plan = createTransactionChunkPlan(text);

    expect(plan.chunkingUsed).toBe(true);
  });

  it('chunks text at 251 lines', () => {
    const text = makeLines(251);
    const plan = createTransactionChunkPlan(text);

    expect(plan.chunkingUsed).toBe(true);
  });

  it('produces minimal second chunk for 181 lines with char threshold', () => {
    // 181 lines with long-enough lines to exceed 12000 chars triggers chunking
    // 180 lines = exactly 1 chunk. 181 lines = 2 chunks:
    // chunk 0: [0..179], chunk 1: [168..180] (12-line overlap + 13 new lines)
    const text = makeLines(181, 'x'.repeat(80)); // 181 * ~85 chars = ~15385 > 12000
    const plan = createTransactionChunkPlan(text);

    expect(plan.chunkingUsed).toBe(true);
    expect(plan.chunks).toHaveLength(2);
    expect(plan.chunks[0].startLine).toBe(0);
    expect(plan.chunks[0].endLine).toBe(179);
    expect(plan.chunks[1].startLine).toBe(168);
    expect(plan.chunks[1].endLine).toBe(180);
    expect(plan.chunks[1].lineCount).toBe(13); // 181 - 168 = 13
  });

  it('assigns correct index values to each chunk', () => {
    const text = makeLines(400);
    const plan = createTransactionChunkPlan(text);

    plan.chunks.forEach((chunk, i) => {
      expect(chunk.index).toBe(i);
    });
    expect(plan.chunks[plan.chunks.length - 1].index).toBe(plan.chunks.length - 1);
  });

  it('handles text with trailing newlines', () => {
    // Trailing \n creates an empty final element from split('\n')
    const text = makeLines(300) + '\n\n';
    const plan = createTransactionChunkPlan(text);

    // 300 lines + 2 empty trailing = 302 lines, still triggers line_threshold
    expect(plan.normalizedLineCount).toBe(302);
    expect(plan.chunkingUsed).toBe(true);
    // Last chunk's endLine should cover all lines including trailing empties
    expect(plan.chunks[plan.chunks.length - 1].endLine).toBe(plan.normalizedLineCount - 1);
  });

  it('handles very long single line exceeding char threshold', () => {
    // One massive line with no newlines, exceeding 12000 chars
    const text = 'x'.repeat(15000);
    const plan = createTransactionChunkPlan(text);

    expect(plan.chunkingUsed).toBe(true);
    expect(plan.chunkTriggerReason).toBe('char_threshold');
    expect(plan.normalizedLineCount).toBe(1);
    // Single line but char-threshold triggered: produces 1 chunk containing the whole text
    expect(plan.chunks).toHaveLength(1);
    expect(plan.chunks[0].text).toBe(text);
  });

  describe('dynamic thresholds from contextWindowTokens', () => {
    it('uses dynamic thresholds when contextWindowTokens provided', () => {
      // 16K context: budgetTokens = (16000 - 2000) / 2.5 = 5600
      // budgetChars = 5600 * 3.5 = 19600
      // budgetLines = 19600 / 55 ≈ 356
      const text = makeLines(360, 'y'.repeat(60));
      const plan = createTransactionChunkPlan(text, 16000);

      expect(plan.chunkingUsed).toBe(true);
      expect(plan.contextWindowTokens).toBe(16000);
    });

    it('falls back to static thresholds when contextWindowTokens undefined', () => {
      const text = makeLines(260);
      const plan = createTransactionChunkPlan(text);

      expect(plan.chunkingUsed).toBe(true);
      expect(plan.chunkTriggerReason).toBe('line_threshold');
      expect(plan.contextWindowTokens).toBeUndefined();
    });

    it('clamps minimum budget for very small context windows', () => {
      // 4K context: budgetTokens = max((4096 - 2000) / 2.5, 500) = max(838, 500) = 838
      // budgetChars = 838 * 3.5 = 2933
      // budgetLines = 2933 / 55 ≈ 53
      // Need text exceeding 53 lines or 2933 chars
      const text = makeLines(60, 'z'.repeat(55));
      const plan = createTransactionChunkPlan(text, 4096);

      expect(plan.chunkingUsed).toBe(true);
      expect(plan.contextWindowTokens).toBe(4096);
    });

    it('sizes chunks using dynamic target line count', () => {
      // 16K context: target ≈ 356 lines
      // 400 lines with overlap 12 → 2 chunks
      const text = makeLines(400, 'a'.repeat(60));
      const plan = createTransactionChunkPlan(text, 16000);

      expect(plan.chunkingUsed).toBe(true);
      expect(plan.chunks.length).toBeGreaterThanOrEqual(2);
    });

    it('stays single-shot when dynamic thresholds are not exceeded', () => {
      // 128K context: huge budget, text is tiny
      const text = makeLines(50);
      const plan = createTransactionChunkPlan(text, 128000);

      expect(plan.chunkingUsed).toBe(false);
      expect(plan.chunkTriggerReason).toBe('single_shot');
      expect(plan.contextWindowTokens).toBe(128000);
    });
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

  it('resolves amount conflicts from chunk overlap (same date/type/description, different amount)', () => {
    const txLow = makeTx({ date: '2024-01-15', description: 'Amazon', amount: 50, type: 'debit', confidence: 0.7 });
    const txHigh = makeTx({ date: '2024-01-15', description: 'Amazon', amount: 75, type: 'debit', confidence: 0.95 });

    const result = mergeChunkTransactions([txLow, txHigh]);

    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].amount).toBe(75);
    expect(result.conflictsResolved).toBe(1);
    expect(result.duplicatesRemoved).toBe(0);
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

  it('resolves amount conflict when both transactions have same explicit originalCurrency', () => {
    const txA = makeTx({ date: '2024-01-15', description: 'Hotel Paris', amount: 150, type: 'debit', originalCurrency: 'USD', originalAmount: 180, confidence: 0.6 });
    const txB = makeTx({ date: '2024-01-15', description: 'Hotel Paris', amount: 175, type: 'debit', originalCurrency: 'USD', originalAmount: 210, confidence: 0.9 });

    const result = mergeChunkTransactions([txA, txB]);
    expect(result.transactions).toHaveLength(1);
    expect(result.conflictsResolved).toBe(1);
    expect(result.transactions[0].amount).toBe(175);
    expect(result.transactions[0].originalCurrency).toBe('USD');
  });

  it('resolves originalAmount:0 vs missing as overlap conflict (same amount, different originalAmount)', () => {
    // Exact signatures differ (originalAmount: '0' vs ''), but conflict key matches
    // — the LLM disagreed on originalAmount for the same overlap-zone transaction
    const txA = makeTx({ date: '2024-01-15', description: 'Hotel', amount: 150, type: 'debit', originalAmount: 0, confidence: 0.7 });
    const txB = makeTx({ date: '2024-01-15', description: 'Hotel', amount: 150, type: 'debit', confidence: 0.9 });

    const result = mergeChunkTransactions([txA, txB]);
    expect(result.transactions).toHaveLength(1);
    expect(result.conflictsResolved).toBe(1);
    expect(result.transactions[0].confidence).toBe(0.9);
  });

  it('deduplicates transactions with same originalAmount', () => {
    const txA = makeTx({ date: '2024-01-15', description: 'Hotel', amount: 150, type: 'debit', originalAmount: 140 });
    const txB = makeTx({ date: '2024-01-15', description: 'Hotel', amount: 150, type: 'debit', originalAmount: 140, confidence: 0.9 });

    const result = mergeChunkTransactions([txA, txB]);
    expect(result.transactions).toHaveLength(1);
    expect(result.duplicatesRemoved).toBe(1);
    expect(result.transactions[0].confidence).toBe(0.9);
  });

  it('normalizes tabs in descriptions', () => {
    const txA = makeTx({ date: '2024-01-15', description: 'AMAZON\t\tMARKETPLACE', amount: 99.99, type: 'debit' });
    const txB = makeTx({ date: '2024-01-15', description: 'amazon marketplace', amount: 99.99, type: 'debit' });

    expect(mergeChunkTransactions([txA, txB]).duplicatesRemoved).toBe(1);
  });

  it('normalizes non-breaking spaces in descriptions', () => {
    const txA = makeTx({ date: '2024-01-15', description: 'AMAZON  MARKETPLACE', amount: 99.99, type: 'debit' });
    const txB = makeTx({ date: '2024-01-15', description: 'amazon marketplace', amount: 99.99, type: 'debit' });

    expect(mergeChunkTransactions([txA, txB]).duplicatesRemoved).toBe(1);
  });

  it('handles transactions with amount 0', () => {
    const txA = makeTx({ date: '2024-01-15', description: 'Zero Txn', amount: 0, type: 'debit' });
    const txB = makeTx({ date: '2024-01-15', description: 'Zero Txn', amount: 0, type: 'debit', confidence: 0.8 });

    const result = mergeChunkTransactions([txA, txB]);
    expect(result.transactions).toHaveLength(1);
    expect(result.duplicatesRemoved).toBe(1);
  });

  it('preserves insertion order for unique transactions', () => {
    const txns = [
      makeTx({ date: '2024-01-01', description: 'First', amount: 10, type: 'debit' }),
      makeTx({ date: '2024-01-02', description: 'Second', amount: 20, type: 'debit' }),
      makeTx({ date: '2024-01-03', description: 'Third', amount: 30, type: 'debit' }),
    ];

    const result = mergeChunkTransactions(txns);
    const descs = result.transactions.map(t => t.description);
    expect(descs).toEqual(['First', 'Second', 'Third']);
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
