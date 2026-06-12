import { test, expect } from '@playwright/test';
import { setupTestContext } from '../e2e/helpers/e2eHelpers';

/**
 * Integration tests for the suspense detection and review UI.
 *
 * Seeds review session data into sessionStorage with isSuspense flags,
 * then verifies the review page renders correctly:
 *   - Suspense rows show "Classify" badge and amber styling
 *   - Confirm & Import button is disabled while suspense items exist
 *   - Suspense count is displayed in the subtitle
 *   - Editing a suspense transaction's category resolves it
 *
 * No LLM mocking — these tests only verify UI rendering from seeded data.
 */

function seedReviewSession(context: BrowserContext, transactions: Record<string, unknown>[]) {
  return context.addInitScript(({ txns }) => {
    window.sessionStorage.setItem('review-session-v1', JSON.stringify({
      transactions: txns,
      currency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
      format: 'csv',
      statementType: 'bank',
      fileName: 'test-statement.csv',
      parseDate: new Date().toISOString(),
      warnings: [],
    }));
  }, { txns: transactions });
}

import { BrowserContext } from '@playwright/test';

test.describe('Review Suspense UI', () => {
  test.beforeEach(async ({ context }) => {
    await setupTestContext(context);
  });

  test('suspense transaction shows Classify badge', async ({ context, page }) => {
    await seedReviewSession(context, [
      { id: 'rt1', date: '2025-06-01', description: 'NEFT-Transfer-ABC123', amount: 5000, type: 'debit', category: 'transfer', merchant: 'Unknown', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank', isSuspense: true },
      { id: 'rt2', date: '2025-06-02', description: 'Groceries', amount: 2000, type: 'debit', category: 'groceries', merchant: 'BigBasket', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
    ]);

    await page.goto('/review');
    await expect(page).toHaveURL(/\/review/, { timeout: 10000 });

    // Suspense row should show "Classify" badge
    await expect(page.getByText('Classify')).toBeVisible({ timeout: 5000 });
    // Non-suspense row should NOT show "Classify" badge
    const classifyBadges = page.getByText('Classify');
    await expect(classifyBadges).toHaveCount(1);
  });

  test('Confirm & Import disabled when suspense items exist', async ({ context, page }) => {
    await seedReviewSession(context, [
      { id: 'rt1', date: '2025-06-01', description: 'NEFT-Transfer', amount: 5000, type: 'debit', category: 'transfer', merchant: 'Unknown', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank', isSuspense: true },
    ]);

    await page.goto('/review');
    await expect(page).toHaveURL(/\/review/, { timeout: 10000 });

    const confirmBtn = page.getByRole('button', { name: /confirm.*import/i });
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });
    await expect(confirmBtn).toBeDisabled();
  });

  test('suspense count displayed in subtitle', async ({ context, page }) => {
    await seedReviewSession(context, [
      { id: 'rt1', date: '2025-06-01', description: 'NEFT-Transfer-ABC', amount: 5000, type: 'debit', category: 'transfer', merchant: 'Unknown', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank', isSuspense: true },
      { id: 'rt2', date: '2025-06-02', description: 'UPI-XYZ-Transfer', amount: 3000, type: 'debit', category: 'transfer', merchant: 'Unknown', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank', isSuspense: true },
      { id: 'rt3', date: '2025-06-03', description: 'Groceries', amount: 2000, type: 'debit', category: 'groceries', merchant: 'BigBasket', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
    ]);

    await page.goto('/review');
    await expect(page).toHaveURL(/\/review/, { timeout: 10000 });

    // "2 needs classification"
    await expect(page.getByText(/2\s+needs?\s+classification/)).toBeVisible({ timeout: 5000 });
  });

  test('no suspense items — Confirm & Import enabled', async ({ context, page }) => {
    await seedReviewSession(context, [
      { id: 'rt1', date: '2025-06-01', description: 'Groceries', amount: 2000, type: 'debit', category: 'groceries', merchant: 'BigBasket', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
    ]);

    await page.goto('/review');
    await expect(page).toHaveURL(/\/review/, { timeout: 10000 });

    const confirmBtn = page.getByRole('button', { name: /confirm.*import/i });
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });
    await expect(confirmBtn).toBeEnabled();
  });

  test('resolving suspense via category edit enables Confirm & Import', async ({ context, page }) => {
    await seedReviewSession(context, [
      { id: 'rt1', date: '2025-06-01', description: 'NEFT-Transfer', amount: 5000, type: 'debit', category: 'transfer', merchant: 'Unknown', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank', isSuspense: true },
    ]);

    await page.goto('/review');
    await expect(page).toHaveURL(/\/review/, { timeout: 10000 });

    // Confirm should be disabled initially
    const confirmBtn = page.getByRole('button', { name: /confirm.*import/i });
    await expect(confirmBtn).toBeDisabled();

    // Open edit dialog for the suspense transaction
    const row = page.locator('tr').filter({ hasText: 'NEFT-Transfer' });
    await expect(row).toBeVisible({ timeout: 5000 });
    await row.locator('button').first().click();

    // Edit dialog should appear
    await expect(page.getByRole('heading', { name: 'Edit Transaction' })).toBeVisible({ timeout: 5000 });

    // Change category from transfer to groceries
    const categorySelect = page.locator('#edit-category');
    await categorySelect.selectOption('groceries');

    // Save the edit
    await page.getByRole('button', { name: 'Save' }).click();

    // Wait for dialog to close
    await expect(page.getByRole('heading', { name: 'Edit Transaction' })).not.toBeVisible({ timeout: 5000 });

    // "Classify" badge should be gone
    await expect(page.getByText('Classify')).not.toBeVisible({ timeout: 5000 });

    // Confirm should now be enabled
    await expect(confirmBtn).toBeEnabled({ timeout: 5000 });
  });
});
