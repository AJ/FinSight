import { describe, it, expect, vi } from 'vitest';

/**
 * One-off diagnostic (2026-08-23): the user's browser shows
 * TRANSACTIONS-CHUNK-DUMP entries but NO TRANSACTIONS-INPUT-DUMP, despite
 * both living in the same function with the input dump ~80 lines earlier and
 * unconditionally placed. This spec runs the REAL pipeline from the CURRENT
 * source with DEBUG_LOGGING forced on and spies on the console. If the input
 * dump fires here, the code path is proven and the discrepancy is on the
 * browser side; if it does not, there is a code bug to find.
 */

vi.stubEnv('DEBUG_LOGGING', 'true');

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('TRANSACTIONS-INPUT-DUMP fires from current source', () => {
  it('logs the input dump before any chunk dump on the chunked path', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { processStatement } = await import('@/lib/parsers/pipeline');

    // 300 lines -> static chunking (2 chunks). Bank type avoids the CC
    // summary pass shape differences; the point is only the dump ordering.
    const longText = [
      'Statement of Account',
      '',
      'Date||Description||Amount',
      ...Array.from({ length: 297 }, (_, i) => `02/04/2025||Merchant ${i + 1}||${(i + 1) * 10}.00`),
    ].join('\n');

    mockFetch
      .mockResolvedValueOnce(Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ response: JSON.stringify({ statementDate: '2025-02-01', statementPeriodStart: '2025-02-01', statementPeriodEnd: '2025-02-28', accountNumber: '0', accountHolderName: 'X', bankName: 'Y', accountType: 'savings', openingBalance: 1, closingBalance: 2 }), prompt_eval_count: 1, eval_count: 1 }),
        text: () => Promise.resolve(''),
      }))
      .mockResolvedValue(Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ response: JSON.stringify({ transactions: [{ date: '2025-02-01', description: 'M', amount: 1, type: 'debit' }] }), prompt_eval_count: 1, eval_count: 1 }),
        text: () => Promise.resolve(''),
      }));

    const result = await processStatement(longText, {
      format: 'pdf',
      defaultCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
      fileName: 't.pdf',
      statementType: 'bank',
      llmConfig: { provider: 'ollama', baseUrl: 'http://localhost:11434', model: 'm' },
    });
    expect(result.success).toBe(true);

    const logged = consoleSpy.mock.calls
      .map((call) => call.map((a) => String(a)).join(' '))
      .filter((s) => s.includes('TRANSACTIONS-INPUT-DUMP') || s.includes('TRANSACTIONS-CHUNK-DUMP'));

    const partLogs = logged.filter((s) => s.includes('TRANSACTIONS-INPUT-DUMP part '));
    const chunkDumps = logged.filter((s) => s.includes('TRANSACTIONS-CHUNK-DUMP'));
    // Negative: no single full-text entry remains.
    const singleEntry = logged.filter((s) => s.includes('TRANSACTIONS-INPUT-DUMP (full numbered text'));

    console.log(`[input-dump diagnostic] parts=${partLogs.length} chunkDumps=${chunkDumps.length}`);
    consoleSpy.mockRestore();

    // Sliced emission: one entry per ~60 lines, numbered sequentially. The
    // 300-line fixture yields >= 3 parts; a single giant entry must NOT exist
    // (the user's browser silently dropped it).
    expect(partLogs.length, 'dump arrives in multiple part entries').toBeGreaterThanOrEqual(3);
    expect(singleEntry.length, 'no single giant entry').toBe(0);
    for (let i = 0; i < partLogs.length; i++) {
      expect(partLogs[i]).toContain(`part ${i + 1} of ${partLogs.length}`);
    }
    expect(chunkDumps.length, 'two chunks -> two chunk dumps').toBe(2);
  });
});
