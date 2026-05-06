import { test, expect } from '@playwright/test';
import { setupTestContext, mockCategorizationAPI } from '../e2e/helpers/e2eHelpers';

test.describe('Chat with data E2E', () => {
  test.beforeEach(async ({ context }) => {
    await setupTestContext(context);
    await mockCategorizationAPI(context);
  });

  test('chat page shows interface when transactions exist — no upload warning', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      window.localStorage.setItem('transaction-storage', JSON.stringify({
        state: {
          transactions: [
            { id: 't1', date: '2025-01-05', description: 'Groceries', amount: -2000, type: 'debit', category: 'groceries', merchant: 'Store', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
            { id: 't2', date: '2025-01-10', description: 'Netflix', amount: -499, type: 'debit', category: 'entertainment', merchant: 'Netflix', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
          ],
        },
        version: 0,
      }));
    });

    await page.goto('/chat');
    // Chat heading must be visible
    await expect(page.getByText(/chat with your statement/i)).toBeVisible({ timeout: 10000 });
    // Must NOT show upload warning since we have transactions
    await expect(page.getByText(/upload.*first|no transactions found/i)).not.toBeVisible({ timeout: 3000 });
    // Chat input must be visible
    const chatInput = page.locator('textarea, input[type="text"]');
    await expect(chatInput.first()).toBeVisible({ timeout: 5000 });
  });

  test('ask question via suggestion chip sends message', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      window.localStorage.setItem('transaction-storage', JSON.stringify({
        state: {
          transactions: [
            { id: 't1', date: '2025-01-05', description: 'Groceries', amount: -2000, type: 'debit', category: 'groceries', merchant: 'Store', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
          ],
        },
        version: 0,
      }));
    });

    await page.goto('/chat');
    await expect(page.getByText(/chat with your statement/i)).toBeVisible({ timeout: 10000 });

    // Suggestion chips must exist when transactions are loaded
    const chip = page.getByRole('button').filter({ hasText: /spend|top|much|categor|trend/i }).first();
    await expect(chip).toBeVisible({ timeout: 5000 });
    const chipText = await chip.textContent();
    expect(chipText).toBeTruthy();

    await chip.click();

    // The chip text must appear as a user message in the chat
    await expect(page.getByText(chipText!).first()).toBeVisible({ timeout: 5000 });
  });
});
