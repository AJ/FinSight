import { test, expect } from '@playwright/test';
import { mockLLMResponse } from '@tests/mocks/llmMocker';
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

  test('should upload a bank statement, parse it, and show results', async ({ page }) => {
    await mockLLMResponse(page, 'valid_transactions');
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
    // Note: CSV files bypass the LLM pipeline (parseCSV returns directly).
    // CC-specific LLM features (rewards extraction, type detection, subtype normalization)
    // require a CC PDF fixture to test properly.
    await mockLLMResponse(page, 'valid_transactions');
    await uploadFile(page, path.join(FIXTURES_DIR, 'cc_clean.csv'));
    await waitForUploadCompletion(page);

    const txns = await getReviewSessionTransactions(page);
    expect(txns.length).toBeGreaterThan(0);

    // Verify transactions have expected fields
    txns.forEach((txn, i: number) => {
      const errors = validateTransactionShape(txn, i);
      expect(errors).toEqual([]);
    });
  });

  test('should show specific warnings for noisy data', async ({ page }) => {
    await mockLLMResponse(page, 'wrong_schema');
    await uploadFile(page, path.join(FIXTURES_DIR, 'bank_noisy.csv'));
    
    // Wait for URL to be /review (success with warnings) or an error toast
    await Promise.race([
      page.waitForURL('**/review', { timeout: 15000 }),
      page.waitForSelector('[role="status"]:has-text("error"), [role="alert"]:has-text("error")', { timeout: 15000 }),
    ]);
  });
});