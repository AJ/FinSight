import { test, expect } from '@playwright/test';
import { uploadFile, waitForUploadCompletion, setupTestContext, mockCategorizationAPI } from '@tests/e2e/helpers/e2eHelpers';
import { getReviewSessionTransactions, clearAllStorage, validateTransactionShape } from '@tests/utils/storageHelpers';
import * as path from 'path';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');

test.describe('FinSight Upload Pipeline', () => {
  test.beforeEach(async ({ page, context }) => {
    await clearAllStorage(context);
    await setupTestContext(context);
    await mockCategorizationAPI(context);
    await page.goto('/');
  });

  test('should successfully parse a bank statement CSV', async ({ page }) => {
    await uploadFile(page, path.join(FIXTURES_DIR, 'bank_clean.csv'));
    await waitForUploadCompletion(page);

    const txns = await getReviewSessionTransactions(page);
    expect(txns.length).toBeGreaterThan(0);
    txns.forEach((txn, i: number) => {
      expect(validateTransactionShape(txn, i)).toEqual([]);
    });
  });

  test('should parse a bank statement CSV and validate transaction shapes', async ({ page }) => {
    await uploadFile(page, path.join(FIXTURES_DIR, 'bank_clean.csv'));
    await waitForUploadCompletion(page);

    const txns = await getReviewSessionTransactions(page);
    expect(txns.length).toBeGreaterThan(0);
    txns.forEach((txn, i: number) => {
      expect(validateTransactionShape(txn, i)).toEqual([]);
    });
  });

  test('should handle noisy CSV data', async ({ page }) => {
    await uploadFile(page, path.join(FIXTURES_DIR, 'bank_noisy.csv'));
    await Promise.race([
      page.waitForURL('**/review', { timeout: 15000 }),
      page.getByRole('alert').waitFor({ timeout: 15000 }),
    ]);
  });

  test('should handle broken CSV data', async ({ page }) => {
    await uploadFile(page, path.join(FIXTURES_DIR, 'bank_broken.csv'));
    await Promise.race([
      page.waitForURL('**/review', { timeout: 15000 }),
      page.getByRole('alert').waitFor({ timeout: 15000 }),
    ]);
  });
});
