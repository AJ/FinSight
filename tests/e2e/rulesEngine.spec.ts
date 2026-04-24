import { test, expect } from '@playwright/test';
import { mockLLMResponse } from '@tests/mocks/llmMocker';
import { uploadFile, waitForUploadCompletion, setupTestContext, mockCategorizationAPI } from '@tests/e2e/helpers/e2eHelpers';
import { getReviewSessionTransactions, clearAllStorage, setLocalStorage } from '@tests/utils/storageHelpers';
import * as path from 'path';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');

test.describe('Rules Engine E2E', () => {
  test.beforeEach(async ({ page, context }) => {
    await clearAllStorage(context);
    await setupTestContext(context);
    await mockCategorizationAPI(context);
    await page.goto('/');
  });

  test('rule should override LLM categorization', async ({ page }) => {
    await setLocalStorage(page, 'categorization-rules', [{ merchant: 'AMAZON', category: 'shopping' }]);
    await mockLLMResponse(page, 'valid_transactions');
    await uploadFile(page, path.join(FIXTURES_DIR, 'bank_clean.csv'));
    await waitForUploadCompletion(page);

    const txns = await getReviewSessionTransactions(page);
    const amazonTxn = txns.find((t) => (t.description as string)?.includes('AMAZON'));
    expect((amazonTxn as Record<string, unknown>)?.category).toBe('shopping');
  });

  test('learned rules should persist across uploads', async ({ page }) => {
    test.slow(); // Two full upload cycles — takes longer than standard 30s
    // Pre-seed a categorization rule
    await setLocalStorage(page, 'categorization-rules', [{ merchant: 'SALARY CREDIT', category: 'income' }]);

    await mockLLMResponse(page, 'valid_transactions');
    await uploadFile(page, path.join(FIXTURES_DIR, 'bank_clean.csv'));
    await waitForUploadCompletion(page);

    const txns = await getReviewSessionTransactions(page);
    const salaryTxn = txns.find((t) => (t.description as string)?.includes('SALARY'));
    expect((salaryTxn as Record<string, unknown>)?.category).toBe('income');

    // Re-upload the same file — the rule should still apply
    await page.goto('/');
    await uploadFile(page, path.join(FIXTURES_DIR, 'bank_clean.csv'));
    await waitForUploadCompletion(page);

    const newTxns = await getReviewSessionTransactions(page);
    const newSalaryTxn = newTxns.find((t) => (t.description as string)?.includes('SALARY'));
    expect((newSalaryTxn as Record<string, unknown>)?.category).toBe('income');
  });
});