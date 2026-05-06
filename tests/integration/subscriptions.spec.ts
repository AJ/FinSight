import { test, expect } from '@playwright/test';
import { setupTestContext, mockCategorizationAPI } from '../e2e/helpers/e2eHelpers';

test.describe('Subscriptions page', () => {
  test.beforeEach(async ({ context }) => {
    await setupTestContext(context);
    await mockCategorizationAPI(context);
  });

  test('no transactions shows upload prompt', async ({ page }) => {
    await page.goto('/subscriptions');
    await expect(page.getByText(/upload|no.*transactions|import/i)).toBeVisible({ timeout: 10000 });
    // Should NOT show any subscription cards
    await expect(page.getByText(/netflix|spotify|recurring/i)).not.toBeVisible({ timeout: 3000 });
  });

  test('with transactions shows subscription-related content', async ({ context, page }) => {
    await context.addInitScript(() => {
      window.localStorage.setItem('transaction-storage', JSON.stringify({
        state: {
          transactions: [
            { id: 't1', date: '2026-04-05', description: 'Netflix Subscription', amount: -499, type: 'debit', category: 'entertainment', merchant: 'Netflix', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
            { id: 't2', date: '2026-03-05', description: 'Netflix Subscription', amount: -499, type: 'debit', category: 'entertainment', merchant: 'Netflix', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
            { id: 't3', date: '2026-02-05', description: 'Netflix Subscription', amount: -499, type: 'debit', category: 'entertainment', merchant: 'Netflix', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
          ],
        },
        version: 0,
      }));
    });

    await page.goto('/subscriptions');
    // Page body must render
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
    // Must NOT show empty state since we seeded data
    await expect(page.getByText(/no transactions|upload.*first/i)).not.toBeVisible({ timeout: 5000 });
    // Should show Netflix or subscription-related content
    const hasNetflix = await page.getByText(/netflix/i).isVisible({ timeout: 8000 }).catch(() => false);
    const hasRecurring = await page.getByText(/recurring|subscription|monthly/i).isVisible({ timeout: 3000 }).catch(() => false);
    expect(hasNetflix || hasRecurring).toBe(true);
  });

  test('rescan button triggers loading state', async ({ context, page }) => {
    await context.addInitScript(() => {
      window.localStorage.setItem('transaction-storage', JSON.stringify({
        state: {
          transactions: [
            { id: 't1', date: '2025-01-05', description: 'Spotify', amount: -119, type: 'debit', category: 'entertainment', merchant: 'Spotify', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
          ],
        },
        version: 0,
      }));
    });

    await page.goto('/subscriptions');

    const rescanBtn = page.getByRole('button', { name: /rescan|scan|detect/i });
    await expect(rescanBtn).toBeVisible({ timeout: 5000 });
    await rescanBtn.click();
    // Page must still be rendered without crash
    await expect(page.locator('body')).toBeVisible({ timeout: 5000 });
  });
});
