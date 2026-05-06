import { test, expect } from '@playwright/test';
import { setupTestContext, mockCategorizationAPI, uploadFile, waitForUploadCompletion } from '../e2e/helpers/e2eHelpers';
import path from 'path';

test.describe('Transactions lifecycle E2E', () => {
  test.beforeEach(async ({ context }) => {
    await setupTestContext(context);
    await mockCategorizationAPI(context);
  });

  test('upload CSV → review → confirm → transactions page shows rows', async ({ page }) => {
    await page.goto('/');
    const fixturePath = path.resolve(__dirname, '../fixtures/bank_statement_valid.csv');
    await uploadFile(page, fixturePath);

    // Should land on review page
    await waitForUploadCompletion(page, 30000);
    await expect(page.getByRole('heading', { name: /review/i })).toBeVisible({ timeout: 15000 });

    // Confirm import
    const confirmBtn = page.getByRole('button', { name: /confirm.*import/i });
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });
    await confirmBtn.click();

    // Navigate to transactions page
    await page.goto('/transactions');
    // Should have transaction rows (not empty state)
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 10000 });
    const rows = await page.locator('tbody tr').count();
    expect(rows).toBeGreaterThan(0);
  });

  test('search filters on transactions page', async ({ context, page }) => {
    await context.addInitScript(() => {
      window.localStorage.setItem('transaction-storage', JSON.stringify({
        state: {
          transactions: [
            { id: 't1', date: '2025-01-05', description: 'Salary Credit', amount: 50000, type: 'credit', category: 'income', merchant: 'Employer', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
            { id: 't2', date: '2025-01-10', description: 'Amazon Purchase', amount: -2500, type: 'debit', category: 'shopping', merchant: 'Amazon', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
          ],
        },
        version: 0,
      }));
    });

    await page.goto('/transactions');
    await expect(page.getByText('Salary Credit')).toBeVisible({ timeout: 10000 });

    const searchInput = page.getByPlaceholder(/search|filter/i);
    await expect(searchInput).toBeVisible({ timeout: 5000 });
    await searchInput.fill('Amazon');
    await expect(page.getByText('Amazon Purchase')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Salary Credit')).not.toBeVisible({ timeout: 5000 });
  });
});
