import { test, expect } from '@playwright/test';
import { setupTestContext, mockCategorizationAPI } from '../e2e/helpers/e2eHelpers';

test.describe('Review page', () => {
  test.beforeEach(async ({ context }) => {
    await setupTestContext(context);
    await mockCategorizationAPI(context);
  });

  test('no session data redirects to home', async ({ page }) => {
    await page.goto('/review');
    await page.waitForURL((url) => !url.pathname.includes('/review'), { timeout: 10000 }).catch(() => null);
    expect(page.url()).not.toContain('/review');
  });

  test('with session data shows pending transactions table', async ({ context, page }) => {
    await context.addInitScript(() => {
      window.sessionStorage.setItem('review-session-v1', JSON.stringify({
        transactions: [
          { id: 'rt1', date: '2025-01-05', description: 'Groceries', amount: -2000, type: 'debit', category: 'groceries', merchant: 'Store', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
          { id: 'rt2', date: '2025-01-10', description: 'Netflix', amount: -499, type: 'debit', category: 'entertainment', merchant: 'Netflix', needsReview: true, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
        ],
        sourceFile: 'test.csv',
        importTimestamp: new Date().toISOString(),
      }));
    });

    await page.goto('/review');
    await expect(page.getByText('Groceries').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Netflix').first()).toBeVisible();
    // Should NOT redirect since we have valid session data
    expect(page.url()).toContain('/review');
  });

  test('cancel clears session and redirects to home', async ({ context, page }) => {
    await context.addInitScript(() => {
      window.sessionStorage.setItem('review-session-v1', JSON.stringify({
        transactions: [
          { id: 'rt1', date: '2025-01-05', description: 'Test Txn', amount: -100, type: 'debit', category: 'other', merchant: 'Test', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
        ],
        sourceFile: 'test.csv',
        importTimestamp: new Date().toISOString(),
      }));
    });

    await page.goto('/review');
    await expect(page.getByText('Test Txn')).toBeVisible({ timeout: 10000 });

    const cancelBtn = page.getByRole('button', { name: /cancel|discard|back/i });
    await expect(cancelBtn).toBeVisible({ timeout: 5000 });
    await cancelBtn.click();
    await page.waitForURL((url) => !url.pathname.includes('/review'), { timeout: 10000 }).catch(() => null);

    // Session must be cleared
    const session = await page.evaluate(() => sessionStorage.getItem('review-session-v1'));
    expect(session).toBeNull();
    // Must have navigated away from /review
    expect(page.url()).not.toContain('/review');
  });
});
