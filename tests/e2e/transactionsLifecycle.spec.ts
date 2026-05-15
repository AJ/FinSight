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

test.describe('Inline Category Editing', () => {
  test.beforeEach(async ({ context }) => {
    await setupTestContext(context);
    await mockCategorizationAPI(context);
  });

  test('inline category editor changes category', async ({ context, page }) => {
    await context.addInitScript(() => {
      window.localStorage.setItem('transaction-storage', JSON.stringify({
        state: {
          transactions: [
            {
              id: 't-cat-1',
              date: '2025-01-05',
              description: 'BigBasket Grocery',
              amount: -1500,
              type: 'debit',
              category: 'other',
              merchant: 'BigBasket',
              needsReview: false,
              localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
              sourceType: 'bank',
            },
          ],
        },
        version: 0,
      }));
    });

    await page.goto('/transactions');
    await expect(page.getByText('BigBasket Grocery')).toBeVisible({ timeout: 10000 });

    // The InlineCategoryEditor renders a button containing the category name
    const categoryButton = page.getByRole('button', { name: /Other/i });
    await expect(categoryButton).toBeVisible({ timeout: 5000 });
    await categoryButton.click();

    // Popover opens with category options — select 'Groceries'
    const groceriesOption = page.getByRole('button', { name: /^Groceries$/i });
    await expect(groceriesOption).toBeVisible({ timeout: 5000 });
    await groceriesOption.click();

    // Wait for popover to close, then verify the table's category button shows 'Groceries'
    const tableCategoryButton = page.getByRole('table').getByRole('button', { name: /Groceries/i });
    await expect(tableCategoryButton).toBeVisible({ timeout: 5000 });
    // The old 'Other' button should no longer be present in the table
    await expect(page.getByRole('table').getByRole('button', { name: /^Other$/i })).not.toBeVisible({ timeout: 5000 });
  });

  test('category change persists after reload', async ({ context, page }) => {
    // Only seed localStorage if transaction-storage doesn't already exist,
    // so the Zustand-persisted category change survives page.reload().
    await context.addInitScript(() => {
      if (!window.localStorage.getItem('transaction-storage')) {
        window.localStorage.setItem('transaction-storage', JSON.stringify({
          state: {
            transactions: [
              {
                id: 't-cat-1',
                date: '2025-01-05',
                description: 'BigBasket Grocery',
                amount: -1500,
                type: 'debit',
                category: 'other',
                merchant: 'BigBasket',
                needsReview: false,
                localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
                sourceType: 'bank',
              },
            ],
          },
          version: 0,
        }));
      }
    });

    await page.goto('/transactions');
    await expect(page.getByText('BigBasket Grocery')).toBeVisible({ timeout: 10000 });

    // Change category from 'Other' to 'Groceries'
    const categoryButton = page.getByRole('button', { name: /Other/i });
    await expect(categoryButton).toBeVisible({ timeout: 5000 });
    await categoryButton.click();

    const groceriesOption = page.getByRole('button', { name: /^Groceries$/i });
    await expect(groceriesOption).toBeVisible({ timeout: 5000 });
    await groceriesOption.click();

    // Wait for the table's category button to reflect the change
    const tableCategoryButton = page.getByRole('table').getByRole('button', { name: /Groceries/i });
    await expect(tableCategoryButton).toBeVisible({ timeout: 5000 });

    // Reload and verify persistence
    await page.reload();
    await expect(page.getByText('BigBasket Grocery')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('table').getByRole('button', { name: /Groceries/i })).toBeVisible({ timeout: 5000 });
  });
});
