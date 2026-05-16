import { test, expect } from '@playwright/test';
import { setupTestContext, mockCategorizationAPI } from '../e2e/helpers/e2eHelpers';
import { clearAllStorage, validateTransactionShape } from '../utils/storageHelpers';

test.describe('Review page — chunked extraction with partial failures', () => {
  test.beforeEach(async ({ context }) => {
    await clearAllStorage(context);
    await setupTestContext(context);
    await mockCategorizationAPI(context);
  });

  test('renders partial transactions when some chunks failed', async ({ page, context }) => {
    // Seed a review session that simulates what the pipeline produces
    // when 2 of 4 chunks fail: some transactions survived, failedChunks is set
    await context.addInitScript(() => {
      window.sessionStorage.setItem('review-session-v1', JSON.stringify({
        transactions: [
          { id: 'ch1-1', date: '2025-01-05', description: 'Grocery Store', amount: -2500, type: 'debit', category: 'groceries', merchant: 'BigBasket', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
          { id: 'ch1-2', date: '2025-01-08', description: 'Electricity Bill', amount: -1800, type: 'debit', category: 'utilities', merchant: 'BESCOM', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
          { id: 'ch4-1', date: '2025-01-28', description: 'Salary Credit', amount: 50000, type: 'credit', category: 'income', merchant: 'Employer', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
        ],
        currency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
        format: 'pdf',
        statementType: 'bank',
        fileName: 'large_bank_statement.pdf',
        parseDate: new Date().toISOString(),
        warnings: [
          'Chunk 2/4 (lines 181-360) failed: LLM call failed: Invalid JSON response',
          'Chunk 3/4 (lines 349-528) failed: LLM call failed: Invalid JSON response',
        ],
        sourceMetadata: {
          failedChunks: [
            'Chunk 2/4 (lines 181-360)',
            'Chunk 3/4 (lines 349-528)',
          ],
          chunkingUsed: true,
          chunkTriggerReason: 'line_threshold',
          totalChunks: 4,
          extractedBeforeDedupe: 3,
          extractedAfterDedupe: 3,
          duplicatesRemoved: 0,
        },
      }));
    });

    await page.goto('/review');

    // Review page should render — not redirect to home
    await expect(page).toHaveURL(/\/review/);

    // Partial transactions should be visible in the table
    await expect(page.getByText('Grocery Store').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Electricity Bill').first()).toBeVisible();
    await expect(page.getByText('Salary Credit').first()).toBeVisible();

    // Validate transaction shapes
    const txns = await page.evaluate(() => {
      const data = window.sessionStorage.getItem('review-session-v1');
      return data ? JSON.parse(data).transactions : [];
    });
    txns.forEach((txn: Record<string, unknown>, i: number) => {
      const errors = validateTransactionShape(txn, i);
      expect(errors).toEqual([]);
    });
  });

  test('stores failed chunks in sourceMetadata for downstream inspection', async ({ page, context }) => {
    await context.addInitScript(() => {
      window.sessionStorage.setItem('review-session-v1', JSON.stringify({
        transactions: [
          { id: 't1', date: '2025-01-05', description: 'Surviving Txn', amount: -500, type: 'debit', category: 'shopping', merchant: 'Amazon', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
        ],
        currency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
        format: 'pdf',
        statementType: 'bank',
        fileName: 'test.pdf',
        parseDate: new Date().toISOString(),
        warnings: ['Chunk 2/3 (lines 181-360) failed: LLM call failed'],
        sourceMetadata: {
          failedChunks: ['Chunk 2/3 (lines 181-360)'],
          chunkingUsed: true,
          totalChunks: 3,
        },
      }));
    });

    await page.goto('/review');
    await expect(page).toHaveURL(/\/review/);

    // Verify sourceMetadata is preserved in sessionStorage
    const metadata = await page.evaluate(() => {
      const data = window.sessionStorage.getItem('review-session-v1');
      return data ? JSON.parse(data).sourceMetadata : null;
    });

    expect(metadata).toBeTruthy();
    expect(metadata.failedChunks).toHaveLength(1);
    expect(metadata.failedChunks[0]).toContain('Chunk 2/3');
    expect(metadata.chunkingUsed).toBe(true);
  });

  test('review page works when no chunks failed (happy path with chunking)', async ({ page, context }) => {
    await context.addInitScript(() => {
      window.sessionStorage.setItem('review-session-v1', JSON.stringify({
        transactions: [
          { id: 'c1', date: '2025-01-05', description: 'Txn From Chunk 1', amount: -100, type: 'debit', category: 'food', merchant: 'Swiggy', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
          { id: 'c2', date: '2025-01-15', description: 'Txn From Chunk 2', amount: -200, type: 'debit', category: 'food', merchant: 'Zomato', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
        ],
        currency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
        format: 'pdf',
        statementType: 'bank',
        fileName: 'large_statement.pdf',
        parseDate: new Date().toISOString(),
        warnings: [],
        sourceMetadata: {
          failedChunks: [],
          chunkingUsed: true,
          chunkTriggerReason: 'char_threshold',
          totalChunks: 2,
          extractedBeforeDedupe: 3,
          extractedAfterDedupe: 2,
          duplicatesRemoved: 1,
        },
      }));
    });

    await page.goto('/review');
    await expect(page).toHaveURL(/\/review/);

    // Deduplication was applied — 2 transactions visible (1 overlap duplicate removed)
    await expect(page.getByText('Txn From Chunk 1').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Txn From Chunk 2').first()).toBeVisible();
  });
});
