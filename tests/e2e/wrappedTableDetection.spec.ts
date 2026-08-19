import { test, expect, type Page } from '@playwright/test';
import { uploadFile, waitForUploadCompletion, setupTestContext } from '@tests/e2e/helpers/e2eHelpers';
import { getReviewSessionTransactions, clearAllStorage } from '@tests/utils/storageHelpers';
import * as path from 'path';

/**
 * Wrapped-table detection — e2e through the REAL upload pipeline: real browser,
 * real pdfjs extraction of the wrapped-geometry fixture (cc_wrapped.pdf: each
 * transaction spans three physical lines, only the middle holds date and
 * amount), real chunking/merge, real review-session persistence. Only the LLM
 * network boundary is mocked, and the mock CAPTURES the transactions-stage
 * prompts so the test can assert the || columned rows actually reached the
 * model input.
 */
const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');
const WRAPPED_PDF = path.join(FIXTURES_DIR, 'cc_wrapped.pdf');

interface MockTxn {
  date: string;
  description: string;
  amount: number;
  type: 'debit' | 'credit';
  sourceLine?: number;
  confidence?: number;
}

const ccSummary = {
  statementDate: '2025-11-02',
  statementPeriodStart: '2025-10-03',
  statementPeriodEnd: '2025-11-02',
  cardIssuer: 'SYNTHETIC',
  cardHolder: 'SYNTHETIC',
  totalDue: 5000,
  minimumDue: 250,
  creditLimit: 100000,
  availableCredit: 95000,
  previousBalance: 0,
};

const ccTransactions: MockTxn[] = [
  { date: '2025-10-04', description: 'SYNTHETIC MERCHANT 1 GURUGRAM IN REF 1001 VT2527800750000000001', amount: 101.35, type: 'debit', sourceLine: 5, confidence: 0.9 },
  { date: '2025-10-05', description: 'SYNTHETIC MERCHANT 2 GURUGRAM IN REF 1002 VT2527800750000000002', amount: 102.35, type: 'debit', sourceLine: 8, confidence: 0.9 },
];

/** Stage-aware LM Studio wire-format mock; captures transactions-stage prompts. */
async function mockStageAwareLLM(page: Page, capturedPrompts: string[]) {
  await page.route(/\/v1\/(chat\/completions|models)/, async (route) => {
    const url = route.request().url();
    if (url.endsWith('/models')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
      return;
    }

    let prompt = '';
    try {
      const body = JSON.parse(route.request().postData() || '{}');
      prompt = Array.isArray(body.messages)
        ? body.messages.map((m: { content?: string }) => m.content ?? '').join('\n')
        : String(body.prompt ?? '');
    } catch {
      // fall through with empty prompt
    }

    let content: string;
    // Transactions stage first — its prompt also mentions summary-side-channel
    // words, so order matters (same lesson as rowIdentity.spec.ts).
    if (prompt.includes('extract ALL individual transactions')) {
      capturedPrompts.push(prompt);
      content = JSON.stringify({ transactions: ccTransactions });
    } else if (prompt.includes('extract ONLY summary-level fields')) {
      content = JSON.stringify(ccSummary);
    } else if (prompt.toLowerCase().includes('categor')) {
      // Keyword fallback is the real behavior when the categorizer is unreachable.
      await route.abort('failed');
      return;
    } else {
      // Fail loudly rather than silently feeding a wrong-stage response.
      await route.abort('failed');
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }),
    });
  });
}

test.describe('Wrapped-table detection — upload → LLM prompt → review', () => {
  test('columned || rows from the wrapped PDF reach the LLM prompt and the review session', async ({ page, context }) => {
    await clearAllStorage(context);
    await setupTestContext(context);

    const transactionsPrompts: string[] = [];
    await mockStageAwareLLM(page, transactionsPrompts);

    await page.goto('/');
    await uploadFile(page, WRAPPED_PDF, { statementType: 'credit_card' });
    await waitForUploadCompletion(page);
    await expect(page).toHaveURL(/\/review/);

    // The geometry output reached the LLM: the header line arrived as columns.
    expect(transactionsPrompts.length).toBeGreaterThan(0);
    const joined = transactionsPrompts.join('\n');
    expect(joined).toContain('DATE & TIME||TRANSACTION DESCRIPTION');
    // A wrapped merchant row arrived as ONE columned row, both description
    // halves rejoined on the same line.
    const wrappedRow = joined.split('\n').find(l => l.includes('SYNTHETIC MERCHANT 1 '));
    expect(wrappedRow).toBeDefined();
    expect(wrappedRow!).toContain('GURUGRAM IN REF');
    expect(wrappedRow!).toContain('VT25278007500000000');

    // Negative: nothing dropped — the review session holds the mock's rows.
    const txns = await getReviewSessionTransactions(page);
    expect(txns.length).toBeGreaterThanOrEqual(2);
  });
});
