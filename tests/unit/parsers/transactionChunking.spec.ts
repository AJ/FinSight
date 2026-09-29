import { describe, it, expect, afterEach } from 'vitest';
import {
  createTransactionChunkPlan,
  mergeChunkTransactions,
  getDroppedTransactionCount,
} from '@/lib/parsers/transactionChunking';
import { calculateMaxOutputTokens, estimateTokens, getOutputTokensPerInputLine } from '@/lib/llm/contextWindow';
import { useSettingsStore, calibrationKey } from '@/lib/store/settingsStore';
import { EXTRACTION_SYSTEM_PROMPT } from '@/lib/llm/prompts';
import { buildTransactionsPrompt } from '@/lib/parsers/extractTransactions';
import { formatCreditCardTransactionInput } from '@/lib/parsers/lineNumbering';
import type { StatementTableInfo } from '@/lib/parsers/extraction/extractionTypes';
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
  it('budgets indexed CC cells and an injected indexed header before sending chunks', () => {
    const headers = [['Date', 'Description', 'Amount'], ['Date', '', 'Description', 'Amount']];
    const source = [headers[0].join('||'), ...Array.from({ length: 40 }, (_, i) =>
      `2025-09-12||Merchant ${i} with a longer description||14897.00`),
    headers[1].join('||'), ...Array.from({ length: 40 }, (_, i) =>
      `2025-09-12||EMI||Merchant ${i + 40} with a longer description||14897.00`) ].join('\n');
    const tables: StatementTableInfo[] = headers.map((header, index) => ({
      headerLineIndex: index * 41,
      dataRowLineIndexes: Array.from({ length: 40 }, (_, row) => index * 41 + row + 1),
      columns: header.map(headerText => ({ headerText, type: 'unknown' })),
    }));
    const input = formatCreditCardTransactionInput(source, tables);
    const overhead = `${EXTRACTION_SYSTEM_PROMPT}\n\n${buildTransactionsPrompt('', 'credit_card')}`;
    const plan = createTransactionChunkPlan(input, 8192, overhead, 80);
    expect(plan.chunkingUsed).toBe(true);
    expect(plan.normalizedTextLength).toBe(input.length);
    expect(input.length).toBeGreaterThan(source.length);
    const header = input.split('\n')[0];
    for (const chunk of plan.chunks) {
      const text = chunk.startLine === 0 ? chunk.text : header + '\n' + chunk.text;
      const request = `${EXTRACTION_SYSTEM_PROMPT}\n\n${buildTransactionsPrompt(text, 'credit_card')}`;
      expect(calculateMaxOutputTokens(8192, request)).toBeGreaterThan(0);
      expect(chunk.text).toContain('[3] "Merchant');
    }
  });

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

  describe('guard-aligned (contextWindowTokens + overhead) sizing', () => {
    // Mirror how pipeline.ts builds the fixed overhead the guard sees: the system prompt plus
    // the transactions template with {RAW_TEXT} removed and {BANK_CONTEXT} resolved.
    const overhead = (type: 'credit_card' | 'bank') =>
      `${EXTRACTION_SYSTEM_PROMPT}\n\n${buildTransactionsPrompt('', type, null)}`;

    // The guard the retry engine runs on each chunk. A chunk passes iff this is non-zero.
    const guardBudget = (chunkText: string, type: 'credit_card' | 'bank', ctx: number) =>
      calculateMaxOutputTokens(ctx, `${EXTRACTION_SYSTEM_PROMPT}\n\n${buildTransactionsPrompt(chunkText, type, null)}`);

    it('falls back to static thresholds when contextWindowTokens undefined', () => {
      const text = makeLines(260);
      const plan = createTransactionChunkPlan(text);

      expect(plan.chunkingUsed).toBe(true);
      expect(plan.chunkTriggerReason).toBe('line_threshold');
      expect(plan.contextWindowTokens).toBeUndefined();
    });

    it('stays single-shot when text fits the guard budget', () => {
      // 128K context: huge budget, text is tiny.
      const text = makeLines(50);
      const plan = createTransactionChunkPlan(text, 128000, overhead('credit_card'));

      expect(plan.chunkingUsed).toBe(false);
      expect(plan.chunkTriggerReason).toBe('single_shot');
      expect(plan.contextWindowTokens).toBe(128000);
    });

    it('every chunk passes the overflow guard, across context windows and pass types', () => {
      // Long-lined, char-heavy text — the shape that broke under line-based sizing. avg ~126
      // chars/line is realistic for CC statements (date + merchant + city + amount + currency).
      const longLine =
        '2026-03-15 AMAZON SELLER SERVICES BANGALORE INR 2,499.00 DR Shopping ##'.padEnd(126, '.');
      const text = Array.from({ length: 600 }, () => longLine).join('\n');

      // Windows large enough to fit the CC prompt overhead (~4.2K tokens); 4096 cannot (see the
      // model-too-small test below) so it is excluded from the guard-invariant matrix.
      for (const ctx of [8192, 16384, 32768]) {
        for (const type of ['credit_card', 'bank'] as const) {
          const plan = createTransactionChunkPlan(text, ctx, overhead(type));
          // Sanity: text this large must trigger chunking for any finite window.
          expect(plan.chunkingUsed, `ctx=${ctx} type=${type}`).toBe(true);
          expect(plan.chunks.length, `ctx=${ctx} type=${type}`).toBeGreaterThan(1);
          // The invariant: no chunk the plan emits may overflow the guard.
          for (const chunk of plan.chunks) {
            expect(guardBudget(chunk.text, type, ctx), `ctx=${ctx} type=${type} chunk=${chunk.index}`).not.toBe(0);
          }
        }
      }
    });

    it('when the window is too small for the CC prompt overhead, the guard rejects even empty input', () => {
      // CC transactions overhead (~4.2K tokens) exceeds a 4096-token window: this is a genuine
      // model-too-small failure, NOT a chunker bug — no split can make a 4.2K-template fit a 4K
      // window. The guard returns 0 on empty raw text, and the plan emits a single best-effort chunk.
      expect(guardBudget('', 'credit_card', 4096)).toBe(0);
      const plan = createTransactionChunkPlan('x'.repeat(600), 4096, overhead('credit_card'));
      expect(plan.chunkingUsed).toBe(false); // maxChars <= 0 → single best-effort chunk
      // Bank overhead is smaller, so 4096 still leaves room — different pass, different outcome.
      expect(guardBudget('', 'bank', 4096)).toBeGreaterThan(0);
    });

    it('regression: CC pass at 16K that previously hard-failed now chunks and passes the guard', () => {
      // The exact failure mode: 200 lines × ~126 chars = ~25.2K chars. Under the old line-based
      // chunker this produced ONE chunk (target 428 lines > 200) of 25.2K chars, which the guard
      // rejected with "Input text exceeds the model's context window (16384 tokens)". The guard
      // budget for CC is lower than bank (the template is ~4K tokens vs ~2.2K), so CC is the
      // harder case — exercising it directly is the meaningful regression guard.
      const longLine =
        '2026-03-15 AMAZON SELLER SERVICES BANGALORE INR 2,499.00 DR Shopping ##'.padEnd(126, '.');
      const text = Array.from({ length: 200 }, () => longLine).join('\n');

      const plan = createTransactionChunkPlan(text, 16384, overhead('credit_card'));

      expect(plan.chunkingUsed).toBe(true);
      expect(plan.chunks.length).toBeGreaterThan(1); // no longer one giant chunk
      for (const chunk of plan.chunks) {
        expect(guardBudget(chunk.text, 'credit_card', 16384)).not.toBe(0);
      }
    });

    it('CC overhead is larger than bank, so CC gets a tighter chunk budget', () => {
      // Documents WHY the regression hit CC and not bank on the same input: the CC transactions
      // template (~4K tokens) is substantially bigger than bank (~2.2K), so for identical text
      // the CC plan fits fewer chars per chunk. Same text, identical ctx, CC chunks more.
      const longLine =
        '2026-03-15 AMAZON SELLER SERVICES BANGALORE INR 2,499.00 DR Shopping ##'.padEnd(126, '.');
      const text = Array.from({ length: 400 }, () => longLine).join('\n');
      const cc = createTransactionChunkPlan(text, 16384, overhead('credit_card'));
      const bank = createTransactionChunkPlan(text, 16384, overhead('bank'));
      expect(cc.chunks.length).toBeGreaterThan(bank.chunks.length);
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

  it('keeps both transactions when only the amount differs (distinct same-day transactions)', () => {
    // Two genuinely distinct transactions: same date/type/description, different amount. The old
    // pass-2 conflict resolution merged these into one (data loss). Exact-signature dedup treats
    // different amounts as distinct and keeps both.
    const txLow = makeTx({ date: '2024-01-15', description: 'Amazon', amount: 50, type: 'debit', confidence: 0.7 });
    const txHigh = makeTx({ date: '2024-01-15', description: 'Amazon', amount: 75, type: 'debit', confidence: 0.95 });

    const result = mergeChunkTransactions([txLow, txHigh]);

    expect(result.transactions).toHaveLength(2);
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

  it('keeps both when amounts differ even with the same explicit originalCurrency', () => {
    const txA = makeTx({ date: '2024-01-15', description: 'Hotel Paris', amount: 150, type: 'debit', originalCurrency: 'USD', originalAmount: 180, confidence: 0.6 });
    const txB = makeTx({ date: '2024-01-15', description: 'Hotel Paris', amount: 175, type: 'debit', originalCurrency: 'USD', originalAmount: 210, confidence: 0.9 });

    const result = mergeChunkTransactions([txA, txB]);
    expect(result.transactions).toHaveLength(2);
    expect(result.duplicatesRemoved).toBe(0);
  });

  it('keeps both when exact signatures differ only on originalAmount (0 vs missing)', () => {
    // Exact signatures differ (originalAmount: '0' vs ''), so exact-signature dedup does NOT
    // collapse them. They survive as two rows; the verification layer (deduplicateTransactions)
    // then flags them as a potential duplicate because amount/date/description match — covered in
    // mergeEngine.spec.ts. Chunk merge itself keeps both.
    const txA = makeTx({ date: '2024-01-15', description: 'Hotel', amount: 150, type: 'debit', originalAmount: 0, confidence: 0.7 });
    const txB = makeTx({ date: '2024-01-15', description: 'Hotel', amount: 150, type: 'debit', confidence: 0.9 });

    const result = mergeChunkTransactions([txA, txB]);
    expect(result.transactions).toHaveLength(2);
    expect(result.duplicatesRemoved).toBe(0);
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

  it('handles transactions with undefined optional fields for signature matching', () => {
    // Exercises the ?? '' and !== undefined branches in buildTransactionSignature
    // and buildConflictKey by omitting optional fields
    const txMinimal: ExtractedTransaction = {
      date: '2024-01-15',
      description: 'Test',
      amount: 50,
      type: 'debit',
    };
    // Second transaction with same core fields, one with confidence and one without
    const txWithConf: ExtractedTransaction = {
      date: '2024-01-15',
      description: 'Test',
      amount: 50,
      type: 'debit',
      confidence: 0.9,
    };

    const result = mergeChunkTransactions([txMinimal, txWithConf]);
    expect(result.transactions).toHaveLength(1);
    expect(result.duplicatesRemoved).toBe(1);
    expect(result.transactions[0].confidence).toBe(0.9);
  });

  it('handles transactions with undefined date and type fields', () => {
    // Exercises the ?? '' branches for date and type in buildTransactionSignature
    const txA = {
      date: undefined,
      description: 'No Date',
      amount: 100,
      type: undefined,
    } as unknown as ExtractedTransaction;
    const txB = {
      date: undefined,
      description: 'No Date',
      amount: 100,
      type: undefined,
      confidence: 0.8,
    } as unknown as ExtractedTransaction;

    const result = mergeChunkTransactions([txA, txB]);
    expect(result.transactions).toHaveLength(1);
    expect(result.duplicatesRemoved).toBe(1);
  });

  it('handles transactions with undefined description', () => {
    // Exercises normalizeDescription with undefined input
    const txA = {
      date: '2024-01-15',
      description: undefined,
      amount: 50,
      type: 'debit',
    } as unknown as ExtractedTransaction;
    const txB = {
      date: '2024-01-15',
      description: undefined,
      amount: 50,
      type: 'debit',
      confidence: 0.9,
    } as unknown as ExtractedTransaction;

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

describe('createTransactionChunkPlan calibrated output budget', () => {
  afterEach(() => {
    useSettingsStore.setState({
      llmModel: null,
      calibrationByModel: {},
    });
  });

  it('reserves output room that covers the calibrated per-line output cost', () => {
    useSettingsStore.setState({
      llmProvider: 'ollama',
      llmModel: 'qwen3-4b',
      calibrationByModel: {
        [calibrationKey('ollama', 'qwen3-4b')!]: { inputCharsPerToken: 2.3, outputTokensPerInputLine: 98 },
      },
    });
    // Many lines, each short, so chunking actually splits.
    const lines = Array.from({ length: 2000 }, (_, i) => `01 MAR MERCHANT ${i} 100.00 DR`);
    const text = lines.join('\n');
    // A CC-style overhead large enough that chunking engages.
    const overhead = 'X'.repeat(16000);
    const plan = createTransactionChunkPlan(text, 16384, overhead);
    expect(plan.chunkingUsed).toBe(true);
    expect(plan.chunks.length).toBeGreaterThan(1);
    // The linear-coupled invariant the chunker honors via calculateMaxItems: each chunk's
    // input (overhead + chunk text) PLUS its reserved output (lineCount * calibrated
    // output/line) must fit the window. This is the real guard — not output alone. Under the
    // old OUTPUT_TOKENS_PER_LINE=5 the chunker would pack ~465 lines/chunk and this sum would
    // blow past the window (~59K), failing here; the calibrated 98 keeps it under.
    for (const c of plan.chunks) {
      const input = estimateTokens(`${overhead}\n${c.text}`);
      const output = c.lineCount * getOutputTokensPerInputLine();
      expect(input + output).toBeLessThan(16384);
    }
  });

  it('falls back to DEFAULT_OUTPUT_TOKENS_PER_LINE (not 5) when uncached', () => {
    // With no calibration, output/line is 90, not the old 5 → chunks are far smaller than the
    // broken path would have produced.
    const lines = Array.from({ length: 2000 }, (_, i) => `01 MAR MERCHANT ${i} 100.00 DR`);
    const text = lines.join('\n');
    const overhead = 'X'.repeat(16000);
    const plan = createTransactionChunkPlan(text, 16384, overhead);
    expect(plan.chunkingUsed).toBe(true);
    // The old OUTPUT_TOKENS_PER_LINE=5 would allow ~465 lines/chunk; 90 allows far fewer.
    const maxLinesPerChunk = Math.max(...plan.chunks.map(c => c.lineCount));
    expect(maxLinesPerChunk).toBeLessThan(200);
  });

  it('goes single-shot on a row budget where the per-line reserve would chunk', () => {
    useSettingsStore.setState({
      llmProvider: 'ollama',
      llmModel: 'qwen3-4b',
      calibrationByModel: {
        [calibrationKey('ollama', 'qwen3-4b')!]: { inputCharsPerToken: 2.3, outputTokensPerInputLine: 50 },
      },
    });
    // 241 lines × ~45 chars: 39 transaction rows, 201 non-transaction lines.
    const rows = Array.from({ length: 39 }, (_, i) => `01 MAR MERCHANT ${i} 100.00 DR`);
    const prose = Array.from({ length: 201 }, (_, i) => `narration line ${i} with summary context text`);
    const text = ['header line', ...rows, ...prose].join('\n');
    const overhead = 'X'.repeat(16000); // ~4174 tokens at 2.3 — CC-scale.
    // Per-line reserve: (45/2.3 × 1.1) + (50 × 1.1) ≈ 76.8/line; budget ≈
    // (16384 − 4591)/76.8 ≈ 153 lines < 241 → per-line would chunk.
    // Per-row: 4591 + (241×45/2.3×1.1 ≈ 5185) + (39×50×1.1 = 2145) ≈ 11921 → fits.
    const plan = createTransactionChunkPlan(text, 16384, overhead, 39);
    expect(plan.chunkingUsed).toBe(false);
    expect(plan.chunkTriggerReason).toBe('single_shot');
  });

  it('still chunks when even the row budget overflows', () => {
    useSettingsStore.setState({
      llmProvider: 'ollama',
      llmModel: 'qwen3-4b',
      calibrationByModel: {
        [calibrationKey('ollama', 'qwen3-4b')!]: { inputCharsPerToken: 2.3, outputTokensPerInputLine: 50 },
      },
    });
    const plan = createTransactionChunkPlan(makeLines(241), 16384, 'X'.repeat(16000), 300);
    expect(plan.chunkingUsed).toBe(true);
    expect(plan.chunks.length).toBeGreaterThan(1);
  });

  it('undefined row count keeps the per-line reserve (behavior unchanged)', () => {
    useSettingsStore.setState({
      llmProvider: 'ollama',
      llmModel: 'qwen3-4b',
      calibrationByModel: {
        [calibrationKey('ollama', 'qwen3-4b')!]: { inputCharsPerToken: 2.3, outputTokensPerInputLine: 50 },
      },
    });
    const rows = Array.from({ length: 39 }, (_, i) => `01 MAR MERCHANT ${i} 100.00 DR`);
    const prose = Array.from({ length: 201 }, (_, i) => `narration line ${i} with summary context text`);
    const text = ['header line', ...rows, ...prose].join('\n');
    const plan = createTransactionChunkPlan(text, 16384, 'X'.repeat(16000));
    expect(plan.chunkingUsed).toBe(true); // per-line reserve chunks it
  });
});

// ─── Row identity: sourceLine collapse + header reserve ─────────────────────

describe('mergeChunkTransactions — sourceLine collapse', () => {
  it('collapses two reads of the same sourceLine even when fields disagree', () => {
    const a = makeTx({ date: '2024-01-15', description: 'AMAZON', amount: 99.99, type: 'debit', originalCurrency: 'USD', originalAmount: 99.99, confidence: 0.9, sourceLine: 40 });
    const b = makeTx({ date: '2024-01-15', description: 'AMAZON', amount: 99.99, type: 'credit', originalCurrency: 'INR', originalAmount: 8300, confidence: 0.6, sourceLine: 40 });
    const merged = mergeChunkTransactions([a, b]);
    expect(merged.transactions).toHaveLength(1);
    expect(merged.duplicatesRemoved).toBe(1);
    expect(merged.transactions[0].confidence).toBe(0.9); // higher-confidence read kept
    expect(merged.transactions[0].type).toBe('debit');
  });

  it('keeps both rows when identical fields carry different sourceLines (distinct rows)', () => {
    const a = makeTx({ date: '2024-01-15', description: 'COFFEE', amount: 5, type: 'debit', confidence: 0.9, sourceLine: 10 });
    const b = makeTx({ date: '2024-01-15', description: 'COFFEE', amount: 5, type: 'debit', confidence: 0.8, sourceLine: 11 });
    const merged = mergeChunkTransactions([a, b]);
    expect(merged.transactions).toHaveLength(2);
    expect(merged.duplicatesRemoved).toBe(0);
  });

  it('falls back to signature dedup for rows without a sourceLine', () => {
    const a = makeTx({ date: '2024-01-15', description: 'AMAZON', amount: 99.99, type: 'debit', confidence: 0.9 });
    const b = makeTx({ date: '2024-01-15', description: 'AMAZON', amount: 99.99, type: 'debit', confidence: 0.7 });
    const merged = mergeChunkTransactions([a, b]);
    expect(merged.transactions).toHaveLength(1);
    expect(merged.duplicatesRemoved).toBe(1);
  });

  it('does not signature-dedup a numbered row against a numberless row', () => {
    const a = makeTx({ date: '2024-01-15', description: 'AMAZON', amount: 99.99, type: 'debit', confidence: 0.9, sourceLine: 40 });
    const b = makeTx({ date: '2024-01-15', description: 'AMAZON', amount: 99.99, type: 'debit', confidence: 0.7 });
    const merged = mergeChunkTransactions([a, b]);
    expect(merged.transactions).toHaveLength(2);
  });

  it('ignores a non-finite sourceLine (treats the row as numberless)', () => {
    const a = makeTx({ date: '2024-01-15', description: 'AMAZON', amount: 99.99, type: 'debit', confidence: 0.9, sourceLine: Number.NaN });
    const b = makeTx({ date: '2024-01-15', description: 'AMAZON', amount: 99.99, type: 'debit', confidence: 0.7 });
    const merged = mergeChunkTransactions([a, b]);
    expect(merged.transactions).toHaveLength(1); // signature fallback applies
  });

  it('preserves first-seen order when numbered and numberless rows are mixed', () => {
    const first = makeTx({ date: '2024-01-01', description: 'First', amount: 10, type: 'debit', sourceLine: 10 });
    const middle = makeTx({ date: '2024-01-02', description: 'Middle', amount: 20, type: 'debit' });
    const last = makeTx({ date: '2024-01-03', description: 'Last', amount: 30, type: 'debit', sourceLine: 12 });

    const merged = mergeChunkTransactions([first, middle, last]);

    expect(merged.transactions.map((tx) => tx.description)).toEqual(['First', 'Middle', 'Last']);
  });
});

describe('createTransactionChunkPlan — header injection reserve', () => {
  const longLine =
    '2026-03-15 AMAZON SELLER SERVICES BANGALORE INR 2,499.00 DR Shopping ##'.padEnd(126, '.');
  const text = Array.from({ length: 600 }, () => longLine).join('\n');
  const overhead = (type: 'credit_card' | 'bank') =>
    `${EXTRACTION_SYSTEM_PROMPT}\n\n${buildTransactionsPrompt('', type, null)}`;
  const guardBudget = (chunkText: string, type: 'credit_card' | 'bank', ctx: number) =>
    calculateMaxOutputTokens(ctx, `${EXTRACTION_SYSTEM_PROMPT}\n\n${buildTransactionsPrompt(chunkText, type, null)}`);

  it('every chunk + one injected header line still passes the overflow guard', () => {
    // The header injected after sizing is the longest line of the statement (worst
    // case — the injected line always comes from this text). The reserve exists so
    // that chunk + injected line never trips the pre-flight guard.
    for (const ctx of [8192, 16384, 32768]) {
      for (const type of ['credit_card', 'bank'] as const) {
        const plan = createTransactionChunkPlan(text, ctx, overhead(type));
        expect(plan.chunkingUsed, `ctx=${ctx}`).toBe(true);
        for (const chunk of plan.chunks) {
          const withHeader = `${longLine}\n${chunk.text}`;
          expect(
            guardBudget(withHeader, type, ctx),
            `ctx=${ctx} type=${type} chunk=${chunk.index}`,
          ).not.toBe(0);
        }
      }
    }
  });
});
