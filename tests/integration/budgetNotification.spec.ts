import { test, expect } from '@playwright/test';
import { freezeBrowserDate } from '@tests/e2e/helpers/e2eHelpers';

test.describe('Budget Notification Banner', () => {
  test('no-budget banner on dashboard', async ({ page, context }) => {
    await freezeBrowserDate(context, '2026-04-15T12:00:00.000Z');
    await context.clearCookies();
    await context.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();

      localStorage.setItem('onboarding-storage', JSON.stringify({
        state: { hasCompletedOnboarding: true },
        version: 1,
      }));
      localStorage.setItem('settings-storage', JSON.stringify({
        state: { llmProvider: 'lmstudio', llmServerUrl: 'http://localhost:1234', llmModel: 'test-model' },
        version: 1,
      }));
      localStorage.setItem('transaction-storage', JSON.stringify({
        state: {
          transactions: [{
            id: 'test-txn-001',
            date: '2026-04-15T12:00:00.000Z',
            description: 'Test grocery purchase',
            amount: 42.50,
            type: 'debit',
            category: 'groceries',
            localCurrency: { code: 'USD', symbol: '$', name: 'US Dollar' },
          }],
          selectedIds: [],
          isCategorizing: false,
          categorizeProgress: '',
        },
        version: 0,
      }));
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Dashboard should show the data view (not WelcomeScreen)
    await expect(page.getByText(/\d+ transactions?/)).toBeVisible({ timeout: 10000 });

    // The no-budget notification text should be visible
    await expect(page.getByText(/no budget for/i)).toBeVisible({ timeout: 10000 });

    // Verify the "Set one up" action button is visible
    await expect(page.getByRole('button', { name: /set one up/i })).toBeVisible();
  });
});
