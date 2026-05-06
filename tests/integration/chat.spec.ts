import { test, expect } from '@playwright/test';
import { setupTestContext, mockCategorizationAPI } from '../e2e/helpers/e2eHelpers';

test.describe('Chat page', () => {
  test.beforeEach(async ({ context }) => {
    await setupTestContext(context);
    await mockCategorizationAPI(context);
  });

  test('no transactions shows upload warning', async ({ page }) => {
    await page.goto('/chat');
    await expect(page.getByText(/upload|no transactions|first/i)).toBeVisible({ timeout: 10000 });
    // Chat input should be disabled or hidden when no transactions
    const chatInput = page.locator('textarea, input[type="text"]');
    if (await chatInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      const isDisabled = await chatInput.getAttribute('disabled');
      const hasPlaceholder = await chatInput.getAttribute('placeholder');
      // Either disabled or has a warning placeholder
      expect(isDisabled !== null || /upload|no transactions|first/i.test(hasPlaceholder || '')).toBe(true);
    }
  });

  test('with transactions shows chat interface with input', async ({ context, page }) => {
    await context.addInitScript(() => {
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
    // Chat input must be visible when transactions exist
    const chatInput = page.locator('textarea, input[type="text"]');
    await expect(chatInput.first()).toBeVisible({ timeout: 10000 });
    // Should NOT show upload warning
    await expect(page.getByText(/upload.*first|no transactions found/i)).not.toBeVisible({ timeout: 3000 });
  });

  test('suggestion chip sends message and appears in chat', async ({ context, page }) => {
    await context.addInitScript(() => {
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

    const chip = page.getByRole('button', { name: /how much|spending|top|categor/i }).first();
    await expect(chip).toBeVisible({ timeout: 5000 });
    const chipText = await chip.textContent();
    await chip.click();

    // The chip text must now appear as a sent message in the conversation
    expect(chipText).toBeTruthy();
    await expect(page.getByText(chipText!).first()).toBeVisible({ timeout: 5000 });
  });

  test('clear chat removes messages', async ({ context, page }) => {
    await context.addInitScript(() => {
      window.localStorage.setItem('transaction-storage', JSON.stringify({
        state: {
          transactions: [
            { id: 't1', date: '2025-01-05', description: 'Test', amount: -100, type: 'debit', category: 'other', merchant: 'Test', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
          ],
        },
        version: 0,
      }));
      window.localStorage.setItem('chat-storage', JSON.stringify({
        state: {
          messages: [
            { id: 'm1', content: 'Test message', role: 'user', timestamp: new Date().toISOString() },
          ],
        },
        version: 0,
      }));
    });

    await page.goto('/chat');

    // Verify seeded message is visible first
    await expect(page.getByText('Test message')).toBeVisible({ timeout: 5000 });

    const clearBtn = page.getByRole('button', { name: /clear|new chat|reset/i });
    await expect(clearBtn).toBeVisible({ timeout: 5000 });
    await clearBtn.click();

    // Messages must be gone
    await expect(page.getByText('Test message')).not.toBeVisible({ timeout: 3000 });
  });
});
