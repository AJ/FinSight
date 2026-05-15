import { test, expect } from '@playwright/test';
import {
  uploadFile,
  waitForUploadCompletion,
  setupTestContext,
} from '@tests/e2e/helpers/e2eHelpers';
import {
  getReviewSessionTransactions,
  validateTransactionShape,
  clearAllStorage,
} from '@tests/utils/storageHelpers';
import { mockLLMResponse } from '@tests/mocks/llmMocker';
import * as path from 'path';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');

// Encrypted PDF fixture created with jspdf, password: "correctpass"
const ENCRYPTED_PDF = path.join(FIXTURES_DIR, 'bank_encrypted.pdf');

test.describe('Password-Protected PDF Upload', () => {
  test.beforeEach(async ({ page, context }) => {
    await clearAllStorage(context);
    await setupTestContext(context);
    await mockLLMResponse(page, 'valid_transactions', { statementType: 'bank' });
    await page.goto('/');
  });

  test('correct password extracts successfully', async ({ page }) => {
    // Upload encrypted PDF — app should detect encryption and show password dialog
    await uploadFile(page, ENCRYPTED_PDF, { statementType: 'bank' });

    // Password dialog should appear
    const passwordInput = page.locator('#pdf-password');
    await expect(passwordInput).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Password Required')).toBeVisible();

    // Enter correct password and submit
    await passwordInput.fill('correctpass');
    await page
      .getByRole('button', { name: 'Unlock & Parse', exact: true })
      .click();

    // Should redirect to /review with extracted transactions
    await waitForUploadCompletion(page);
    await expect(page).toHaveURL(/\/review/);

    const txns = await getReviewSessionTransactions(page);
    expect(txns.length).toBeGreaterThan(0);
    txns.forEach((txn, i) => {
      expect(validateTransactionShape(txn, i)).toEqual([]);
    });
  });

  test('wrong password shows error, retry with correct password succeeds', async ({
    page,
  }) => {
    // Upload encrypted PDF — app should detect encryption and show password dialog
    await uploadFile(page, ENCRYPTED_PDF, { statementType: 'bank' });

    const passwordInput = page.locator('#pdf-password');
    await expect(passwordInput).toBeVisible({ timeout: 30_000 });

    // Enter wrong password
    await passwordInput.fill('wrongpass');
    await page
      .getByRole('button', { name: 'Unlock & Parse', exact: true })
      .click();

    // Should show incorrect-password error message
    await expect(page.getByText(/Incorrect password.*attempt/i)).toBeVisible({
      timeout: 10_000,
    });

    // Dialog re-mounts with fresh input (key changes with reason)
    const retryInput = page.locator('#pdf-password');
    await expect(retryInput).toBeVisible({ timeout: 5_000 });

    // Enter correct password
    await retryInput.fill('correctpass');
    await page
      .getByRole('button', { name: 'Unlock & Parse', exact: true })
      .click();

    // Should redirect to /review with extracted transactions
    await waitForUploadCompletion(page);
    await expect(page).toHaveURL(/\/review/);

    const txns = await getReviewSessionTransactions(page);
    expect(txns.length).toBeGreaterThan(0);
    txns.forEach((txn, i) => {
      expect(validateTransactionShape(txn, i)).toEqual([]);
    });
  });
});
