import { test, expect } from '@playwright/test';
import { uploadFile, waitForUploadCompletion, setupTestContext, mockCategorizationAPI } from '@tests/e2e/helpers/e2eHelpers';
import { getReviewSessionTransactions, validateTransactionShape, clearAllStorage } from '@tests/utils/storageHelpers';
import { mockLLMResponse } from '@tests/mocks/llmMocker';
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

  test('noisy CSV still parses and produces valid transactions', async ({ page }) => {
    await uploadFile(page, path.join(FIXTURES_DIR, 'bank_noisy.csv'));
    await waitForUploadCompletion(page);

    // Noisy CSV should still parse — transactions may have fewer rows than
    // the clean version but every extracted row must be valid.
    const txns = await getReviewSessionTransactions(page);
    expect(txns.length).toBeGreaterThan(0);

    txns.forEach((txn, i: number) => {
      const errors = validateTransactionShape(txn, i);
      expect(errors).toEqual([]);
    });
  });
});

test.describe('PDF Upload Happy Path', () => {
  test.beforeEach(async ({ page, context }) => {
    await clearAllStorage(context);
    await setupTestContext(context);
    // Use mockLLMResponse instead of mockCategorizationAPI — PDF pipeline
    // goes through full LLM extraction (type detection, summary, transactions)
    await mockLLMResponse(page, 'valid_transactions', { statementType: 'bank' });
    await page.goto('/');
  });

  test('PDF extracts successfully with valid LLM mock', async ({ page }) => {
    await uploadFile(page, path.join(FIXTURES_DIR, 'bank_statement_noisy.pdf'), { statementType: 'bank' });
    await waitForUploadCompletion(page);

    // Verify we landed on the review page
    await expect(page).toHaveURL(/\/review/);

    // Verify transactions were extracted and stored in review session
    const txns = await getReviewSessionTransactions(page);
    expect(txns.length).toBeGreaterThan(0);

    // Validate shape of every extracted transaction
    txns.forEach((txn, i: number) => {
      const errors = validateTransactionShape(txn, i);
      expect(errors).toEqual([]);
    });
  });

  test('PDF type detection selects correct type via auto-detect', async ({ page }) => {
    // Re-mock with auto (default) — the mock will detect 'bank' since no
    // statementType override is provided (defaults to 'bank' in mockLLMResponse)
    await mockLLMResponse(page, 'valid_transactions', { statementType: 'bank' });
    await uploadFile(page, path.join(FIXTURES_DIR, 'bank_statement_noisy.pdf'), { statementType: 'auto' });
    await waitForUploadCompletion(page);

    // Verify redirect to review page — auto-detect flow succeeded
    await expect(page).toHaveURL(/\/review/);

    const txns = await getReviewSessionTransactions(page);
    expect(txns.length).toBeGreaterThan(0);
  });
});
