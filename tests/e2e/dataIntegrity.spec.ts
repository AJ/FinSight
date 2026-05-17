import { test, expect } from '@playwright/test';
import { mockLLMResponse } from '@tests/mocks/llmMocker';
import { uploadFile, waitForUploadCompletion, verifyUIMatchesStorage, setupTestContext, mockCategorizationAPI, closeAllDialogs } from '@tests/e2e/helpers/e2eHelpers';
import { getReviewSessionTransactions, clearAllStorage } from '@tests/utils/storageHelpers';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

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

test.describe('Cross-file Duplicate Detection', () => {
  test.beforeEach(async ({ page, context }) => {
    await clearAllStorage(context);
    await setupTestContext(context);
    await mockCategorizationAPI(context);
    await page.goto('/');
  });

  test('uploading previously imported file shows duplicate warning', async ({ page }) => {
    await mockLLMResponse(page, 'valid_transactions');

    // First upload: complete the full import flow so transactions are committed to transactionStore.
    await uploadFile(page, path.join(FIXTURES_DIR, 'bank_clean.csv'));
    await waitForUploadCompletion(page);
    await expect(page).toHaveURL(/\/review/);

    // Confirm the import on the review page to commit transactions to the store
    const confirmBtn = page.getByRole('button', { name: /confirm & import/i });
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });
    await confirmBtn.click();

    // Wait for redirect to dashboard (import committed)
    await page.waitForURL('**/dashboard', { timeout: 10000 });

    // Go back to home page
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Upload Statement', exact: true })).toBeVisible({ timeout: 5000 });

    // Open the upload dialog and set the file input directly.
    // We bypass uploadFile() because if the duplicate IS detected, the statement type
    // dialog won't appear (the duplicate dialog appears instead), causing uploadFile to
    // fail at the Continue button. Setting the file input directly triggers
    // handleFileSelect which computes the hash and checks for duplicates.
    await closeAllDialogs(page);
    await page.getByRole('button', { name: 'Upload Statement', exact: true }).click();
    await expect(page.getByText('Upload Your Statement')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(100);
    const fileInput = page.locator('#file-upload');
    await fileInput.setInputFiles(path.join(FIXTURES_DIR, 'bank_clean.csv'));

    // Duplicate dialog should appear (handleFileSelect detected the hash match)
    const duplicateDialog = page.getByRole('dialog');
    await expect(duplicateDialog).toBeVisible({ timeout: 10000 });

    // Verify dialog contains duplicate warning text
    await expect(duplicateDialog.getByText(/already imported/i)).toBeVisible();
  });

  test('Import Anyway proceeds with duplicate file', async ({ page, context }) => {
    const fixturePath = path.join(FIXTURES_DIR, 'bank_clean.csv');

    // Compute the SHA-256 hash of the fixture file in Node.js.
    const fileBuffer = fs.readFileSync(fixturePath);
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // Seed transaction-storage with a transaction whose sourceFileHash matches.
    const seededTxn = {
      id: 'seeded-txn-001',
      date: '2025-10-03T00:00:00.000Z',
      description: 'SEEDED TRANSACTION FOR DUPLICATE TEST',
      amount: 100.00,
      type: 'debit',
      balance: 49900.00,
      category: 'other',
      categoryConfidence: 1,
      needsReview: false,
      sourceType: 'bank',
      sourceFileHash: fileHash,
      localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
    };

    await context.addInitScript(({ txn }: { hash: string; txn: object }) => {
      const storage = {
        state: {
          transactions: [txn],
          selectedIds: [],
          isCategorizing: false,
          categorizeProgress: '',
        },
        version: 0,
      };
      localStorage.setItem('transaction-storage', JSON.stringify(storage));
    }, { hash: fileHash, txn: seededTxn });

    // Reload to pick up the seeded storage
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Upload Statement', exact: true })).toBeVisible({ timeout: 5000 });

    await mockLLMResponse(page, 'valid_transactions');

    // Open the upload dialog and set the file input directly (bypass uploadFile).
    await closeAllDialogs(page);
    await page.getByRole('button', { name: 'Upload Statement', exact: true }).click();
    await expect(page.getByText('Upload Your Statement')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(100);
    const fileInput = page.locator('#file-upload');
    await fileInput.setInputFiles(fixturePath);

    // Duplicate dialog should appear
    const duplicateDialog = page.getByRole('dialog');
    await expect(duplicateDialog).toBeVisible({ timeout: 10000 });

    // Click "Import Anyway"
    const importAnywayBtn = duplicateDialog.getByRole('button', { name: /import anyway/i });
    await expect(importAnywayBtn).toBeVisible();
    await importAnywayBtn.click();

    // Verify import proceeds to review page
    await waitForUploadCompletion(page);
    await expect(page).toHaveURL(/\/review/);
  });
});