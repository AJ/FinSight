import { test, expect } from '@playwright/test';
import { mockLLMResponse } from '@tests/mocks/llmMocker';
import { uploadFile, waitForUploadCompletion, verifyUIMatchesStorage, setupTestContext, mockCategorizationAPI } from '@tests/e2e/helpers/e2eHelpers';
import { getReviewSessionTransactions, clearAllStorage } from '@tests/utils/storageHelpers';
import * as path from 'path';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');

test.describe('Data Integrity E2E', () => {
  test.beforeEach(async ({ page, context }) => {
    await clearAllStorage(context);
    await setupTestContext(context);
    await mockCategorizationAPI(context);
    await page.goto('/');
  });

  test('UI should match localStorage after upload', async ({ page }) => {
    await mockLLMResponse(page, 'valid_transactions');
    await uploadFile(page, path.join(FIXTURES_DIR, 'bank_clean.csv'));
    await waitForUploadCompletion(page);
    const errors = await verifyUIMatchesStorage(page);
    expect(errors).toEqual([]);
  });

  test('duplicate upload should not create duplicate transactions', async ({ page }) => {
    await mockLLMResponse(page, 'valid_transactions');
    await uploadFile(page, path.join(FIXTURES_DIR, 'bank_clean.csv'));
    await waitForUploadCompletion(page);
    const firstTxns = await getReviewSessionTransactions(page);

    await page.goto('/');
    await uploadFile(page, path.join(FIXTURES_DIR, 'bank_clean.csv'));
    await waitForUploadCompletion(page);
    const secondTxns = await getReviewSessionTransactions(page);

    expect(secondTxns.length).toBeLessThanOrEqual(firstTxns.length);
  });
});