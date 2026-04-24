import { test, expect } from '@playwright/test';
import { mockLLMResponse } from '@tests/mocks/llmMocker';
import { uploadFile, waitForUploadCompletion, setupTestContext } from '@tests/e2e/helpers/e2eHelpers';
import { getReviewSessionTransactions, clearAllStorage, validateTransactionShape } from '@tests/utils/storageHelpers';
import * as path from 'path';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');

test.describe('FinSight Upload Pipeline', () => {
  test.beforeEach(async ({ page, context }) => {
    await clearAllStorage(context);
    await setupTestContext(context);
    await page.goto('/');
  });

  test('should successfully parse a bank statement with valid LLM response', async ({ page }) => {
    await mockLLMResponse(page, 'valid_transactions');
    await uploadFile(page, path.join(FIXTURES_DIR, 'bank_clean.csv'));
    await waitForUploadCompletion(page);

    const txns = await getReviewSessionTransactions(page);
    expect(txns.length).toBeGreaterThan(0);
    txns.forEach((txn, i: number) => {
      expect(validateTransactionShape(txn, i)).toEqual([]);
    });
  });

  test('should handle malformed LLM JSON gracefully', async ({ page }) => {
    await mockLLMResponse(page, 'malformed_json');
    await uploadFile(page, path.join(FIXTURES_DIR, 'bank_clean.csv'));
    // Wait for URL to be /review or wait for an error toast/alert
    await Promise.race([
      page.waitForURL('**/review', { timeout: 15000 }),
      page.waitForSelector('[role="status"]:has-text("error"), [role="alert"]:has-text("error")', { timeout: 15000 }),
    ]);
  });

  test('should warn on partial chunk success', async ({ page }) => {
    await mockLLMResponse(page, 'partial_output');
    await uploadFile(page, path.join(FIXTURES_DIR, 'bank_clean.csv'));
    await Promise.race([
      page.waitForURL('**/review', { timeout: 15000 }),
      page.waitForSelector('[role="status"]:has-text("warning"), [role="alert"]:has-text("warning")', { timeout: 15000 }),
    ]);
  });

  test('should handle LLM timeout', async ({ page }) => {
    await mockLLMResponse(page, 'timeout');
    await uploadFile(page, path.join(FIXTURES_DIR, 'bank_clean.csv'));
    await Promise.race([
      page.waitForURL('**/review', { timeout: 20000 }),
      page.waitForSelector('[role="status"]:has-text("timeout"), [role="alert"]:has-text("timeout")', { timeout: 20000 }),
    ]);
  });
});
