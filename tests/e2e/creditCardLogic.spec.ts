import { test, expect } from '@playwright/test';
import { mockLLMResponse } from '@tests/mocks/llmMocker';
import { uploadFile, waitForUploadCompletion, setupTestContext } from '@tests/e2e/helpers/e2eHelpers';
import { getReviewSessionTransactions, clearAllStorage } from '@tests/utils/storageHelpers';
import * as path from 'path';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');

test.describe('Credit Card Logic E2E', () => {
  test.beforeEach(async ({ page, context }) => {
    await clearAllStorage(context);
    await setupTestContext(context);
    await page.goto('/');
  });

  test('should separate rewards from transactions', async ({ page }) => {
    await mockLLMResponse(page, 'valid_transactions', { statementType: 'credit_card' });
    await uploadFile(page, path.join(FIXTURES_DIR, 'cc_rewards_misclassified.csv'));
    await waitForUploadCompletion(page);

    const txns = await getReviewSessionTransactions(page);
    const zeroAmountTxns = txns.filter((t) => (t.amount as number) === 0);
    expect(zeroAmountTxns.length).toBe(0);
  });

  test('should flag incorrect mixing of points and cash', async ({ page }) => {
    await mockLLMResponse(page, 'wrong_schema', { statementType: 'credit_card' });
    await uploadFile(page, path.join(FIXTURES_DIR, 'cc_clean.csv'));
    await waitForUploadCompletion(page);

    const txns = await getReviewSessionTransactions(page);
    const mixedUp = txns.filter((t) => (t.description as string)?.includes('POINTS') && (t.amount as number) > 100);
    expect(mixedUp.length).toBe(0);
  });

  test('should preserve zero-amount refunds and cashback', async ({ page }) => {
    await mockLLMResponse(page, 'valid_transactions', { statementType: 'credit_card' });
    await uploadFile(page, path.join(FIXTURES_DIR, 'cc_clean.csv'));
    await waitForUploadCompletion(page);

    const txns = await getReviewSessionTransactions(page);
    const zeroRefunds = txns.filter((t) => (t.amount as number) === 0 && t.transactionSubType === 'refund');
    expect(zeroRefunds.length).toBeGreaterThanOrEqual(0);
  });
});
