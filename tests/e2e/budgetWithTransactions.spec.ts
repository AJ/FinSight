import { test, expect } from '@playwright/test';
import { clearAllStorage } from '@tests/utils/storageHelpers';
import { freezeBrowserDate, setupTestContext } from '@tests/e2e/helpers/e2eHelpers';

/**
 * Build a transaction-storage payload that the Zustand persist middleware
 * can hydrate on page load. The Transaction model rehydrates from JSON
 * via Transaction.fromJSON(), which expects `category` as a category ID string.
 */
/**
 * Seed transactions via context.addInitScript so they're available
 * immediately on navigation (avoids SecurityError from about:blank).
 */
async function seedTransactions(context: import('@playwright/test').BrowserContext) {
  const now = new Date();
  const transactions = [
    {
      id: 't1',
      date: now.toISOString(),
      description: 'Big Basket',
      amount: 2500,
      type: 'debit',
      category: 'groceries',
      localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
      isInternational: false,
    },
    {
      id: 't2',
      date: now.toISOString(),
      description: 'Swiggy',
      amount: 800,
      type: 'debit',
      category: 'dining',
      localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
      isInternational: false,
    },
    {
      id: 't3',
      date: now.toISOString(),
      description: 'Uber Ride',
      amount: 350,
      type: 'debit',
      category: 'transportation',
      localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
      isInternational: false,
    },
  ];

  const payload = JSON.stringify({
    state: { transactions, selectedIds: [], isCategorizing: false, categorizeProgress: '' },
    version: 0,
  });

  await context.addInitScript((data: string) => {
    localStorage.setItem('transaction-storage', data);
  }, payload);
}

test.describe('Budget With Transactions', () => {
  test.beforeEach(async ({ context }) => {
    await clearAllStorage(context);
    await setupTestContext(context);
  });

  test('Track tab shows spending rows when transactions exist', async ({ page, context }) => {
    await seedTransactions(context);
    await page.goto('/budget');

    // Track tab is the default. The spending table should show category rows.
    // The BudgetTable renders visible progress rows for categories with budgeted > 0 or spent > 0.
    // Our transactions should produce spending for groceries, dining, transportation.
    await expect(page.getByText('Groceries')).toBeVisible();
    await expect(page.getByText('Dining')).toBeVisible();
    await expect(page.getByText('Transportation')).toBeVisible();
  });

  test('Info banner shows when transactions exist but no budget', async ({ page, context }) => {
    await seedTransactions(context);
    await page.goto('/budget');

    // The BudgetInfoBanner should be visible since there are transactions but no budget.
    await expect(page.getByText('no budget has been set for this month')).toBeVisible();
    // The "Set Budget" button inside the banner should be visible.
    await expect(page.getByRole('button', { name: /set budget/i })).toBeVisible();
  });

  test('Budget can be created after seeing spending', async ({ page, context }) => {
    await seedTransactions(context);
    await page.goto('/budget');

    // Verify we're on Track tab and see the info banner.
    await expect(page.getByText('no budget has been set for this month')).toBeVisible();

    // Click "Set Budget" in the info banner.
    await page.getByRole('button', { name: /set budget/i }).click();

    // Should now be on the Plan tab. Verify by checking for Total Budget label.
    await expect(page.getByText('Total Budget')).toBeVisible();

    // Set a budget.
    const budgetInput = page.locator('input[type="number"]').first();
    await budgetInput.fill('50000');

    // Apply a template to create category allocations.
    await page.getByRole('button', { name: /template/i }).click();
    await page.getByText('50/30/20').click();

    // Save.
    await page.getByRole('button', { name: /save/i }).click();

    // Switch back to Track tab.
    await page.getByRole('button', { name: 'Track' }).click();

    // The summary cards should now show budget data.
    await expect(page.getByText('Budgeted')).toBeVisible();
    // The "No Budget" indicator should be gone — the Budgeted card should show
    // an actual value instead of the em-dash placeholder.
    await expect(page.getByText('No Budget')).not.toBeVisible();
    // Verify the Balance card is visible (confirming budget data rendered).
    await expect(page.getByText('Balance')).toBeVisible();
  });

  test('dashboard notification with transactions but no budget', async ({ page, context }) => {
    await freezeBrowserDate(page.context(), '2026-04-15T12:00:00.000Z');
    await seedTransactions(context);
    await page.goto('/');

    // Wait for dashboard to render the data view
    await expect(page.getByText('Dashboard')).toBeVisible({ timeout: 10000 });

    // The budget notification banner should be visible since no budget is set
    const noBudgetText = page.getByText(/no budget for/i);
    await expect(noBudgetText).toBeVisible({ timeout: 10000 });

    // Click "Set one up" to navigate to budget plan page
    const actionButton = page.getByRole('button', { name: /set one up/i });
    await actionButton.click();

    // Verify navigation to budget plan page
    await expect(page).toHaveURL(/\/budget/, { timeout: 10000 });
    await expect(page).toHaveURL(/tab=plan/, { timeout: 5000 });

    // Total Budget input should be visible
    await expect(page.getByText('Total Budget')).toBeVisible();
  });
});
