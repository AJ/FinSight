import { test, expect, type BrowserContext } from '@playwright/test';
import { clearAllStorage } from '@tests/utils/storageHelpers';
import { setupTestContext } from '@tests/e2e/helpers/e2eHelpers';

/**
 * Cross-page journey: the dashboard's AnomalySummaryCard deep-links to
 * /transactions?anomaly=true, and the anomaly filter must be active on arrival.
 */

const INR = { code: 'INR', symbol: '₹', name: 'Indian Rupee' };

async function seedWithAnomaly(context: BrowserContext) {
  const transactions = [
    { id: 'a1', date: '2024-01-15T00:00:00.000Z', description: 'Amazon Card Purchase', amount: 1299, type: 'debit', category: 'shopping', localCurrency: INR, sourceType: 'credit_card', isAnomaly: true },
    { id: 'n1', date: '2024-01-10T00:00:00.000Z', description: 'Big Basket', amount: 2500, type: 'debit', category: 'groceries', localCurrency: INR, sourceType: 'bank' },
  ];
  const payload = JSON.stringify({
    state: { transactions, selectedIds: [], isCategorizing: false, categorizeProgress: '' },
    version: 0,
  });
  await context.addInitScript((data: string) => {
    localStorage.setItem('transaction-storage', data);
  }, payload);
}

const row = (page: import('@playwright/test').Page, text: string) =>
  page.locator('tbody tr').filter({ hasText: text });

test.describe('Transactions deep-link from dashboard', () => {
  test.beforeEach(async ({ context }) => {
    await clearAllStorage(context);
    await setupTestContext(context);
  });

  test('AnomalySummaryCard "Review" deep-links to the filtered transactions page', async ({ page, context }) => {
    await seedWithAnomaly(context);
    await page.goto('/');

    // The card only renders when an active anomaly exists.
    const reviewBtn = page.getByRole('button', { name: 'Review', exact: true });
    await expect(reviewBtn).toBeVisible({ timeout: 10000 });
    await reviewBtn.click();

    // Arrived at the transactions page with the anomaly deep-link.
    await expect(page).toHaveURL(/\/transactions\?anomaly=true/);

    // The filter is active on arrival: only the anomaly shows, the normal row is hidden.
    await expect(row(page, 'Amazon Card Purchase')).toBeVisible();
    await expect(row(page, 'Big Basket')).toBeHidden();
  });
});
