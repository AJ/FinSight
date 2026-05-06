import { test, expect } from '@playwright/test';
import { setupTestContext, mockCategorizationAPI } from '../e2e/helpers/e2eHelpers';

test.describe('Subscriptions discovery E2E', () => {
  test.beforeEach(async ({ context }) => {
    await setupTestContext(context);
    await mockCategorizationAPI(context);
  });

  test('seeded recurring transactions produce subscription content', async ({ context, page }) => {
    await context.addInitScript(() => {
      window.localStorage.setItem('transaction-storage', JSON.stringify({
        state: {
          transactions: [
            { id: 't1', date: '2026-04-05', description: 'Netflix', amount: -499, type: 'debit', category: 'entertainment', merchant: 'Netflix', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
            { id: 't2', date: '2026-03-05', description: 'Netflix', amount: -499, type: 'debit', category: 'entertainment', merchant: 'Netflix', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
            { id: 't3', date: '2026-02-05', description: 'Netflix', amount: -499, type: 'debit', category: 'entertainment', merchant: 'Netflix', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
          ],
        },
        version: 0,
      }));
    });

    await page.goto('/subscriptions');
    // Page must render
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 });

    // Must NOT show "no transactions" since we seeded data
    await expect(page.getByText(/no transactions|upload.*first/i)).not.toBeVisible({ timeout: 5000 });

    // Must show Netflix or subscription-related content (recurring pattern detected)
    const hasNetflix = await page.getByText(/netflix/i).isVisible({ timeout: 8000 }).catch(() => false);
    const hasRecurring = await page.getByText(/recurring|subscription|monthly/i).isVisible({ timeout: 3000 }).catch(() => false);
    expect(hasNetflix || hasRecurring).toBe(true);
  });

  test('no transactions shows empty state with upload prompt', async ({ page }) => {
    await page.goto('/subscriptions');
    await expect(page.getByText(/upload|no.*transactions|import/i)).toBeVisible({ timeout: 10000 });
    // Should NOT show subscription cards
    await expect(page.getByText(/netflix|spotify|monthly.*fee/i)).not.toBeVisible({ timeout: 3000 });
  });
});
