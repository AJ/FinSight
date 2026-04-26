import { test, expect } from '@playwright/test';
import { uploadFile, waitForUploadCompletion, setupTestContext, mockCategorizationAPI } from '@tests/e2e/helpers/e2eHelpers';
import { getReviewSessionTransactions, validateTransactionShape, clearAllStorage } from '@tests/utils/storageHelpers';
import * as path from 'path';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');

test.describe('Upload → Full Pipeline E2E', () => {
  test.beforeEach(async ({ page, context }) => {
    await clearAllStorage(context);
    await setupTestContext(context);
    await mockCategorizationAPI(context);
    await page.goto('/');
  });

  test('should upload a bank statement CSV, parse it, and show results', async ({ page }) => {
    await uploadFile(page, path.join(FIXTURES_DIR, 'bank_clean.csv'));
    await waitForUploadCompletion(page);

    const txns = await getReviewSessionTransactions(page);
    expect(txns.length).toBeGreaterThan(0);

    const amazonTxn = txns.find((t) => (t.description as string)?.includes('AMAZON IN'));
    expect((amazonTxn?.amount as number)).toBe(1299);
    expect(amazonTxn?.type).toBe('debit');

    txns.forEach((txn, i: number) => {
      const errors = validateTransactionShape(txn, i);
      expect(errors).toEqual([]);
    });
  });

  test('should upload a CC statement CSV and parse it successfully', async ({ page }) => {
    await uploadFile(page, path.join(FIXTURES_DIR, 'cc_clean.csv'));
    await waitForUploadCompletion(page);

    const txns = await getReviewSessionTransactions(page);
    expect(txns.length).toBeGreaterThan(0);

    txns.forEach((txn, i: number) => {
      const errors = validateTransactionShape(txn, i);
      expect(errors).toEqual([]);
    });
  });

  test('should show specific warnings for noisy data', async ({ page }) => {
    await uploadFile(page, path.join(FIXTURES_DIR, 'bank_noisy.csv'));

    await Promise.race([
      page.waitForURL('**/review', { timeout: 15000 }),
      page.waitForSelector('[role="status"]:has-text("error"), [role="alert"]:has-text("error")', { timeout: 15000 }),
    ]);
  });
});
