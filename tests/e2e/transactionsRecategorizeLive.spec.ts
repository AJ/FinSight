import { test, expect, type BrowserContext } from '@playwright/test';
import { clearAllStorage } from '@tests/utils/storageHelpers';
import { setupTestContext } from '@tests/e2e/helpers/e2eHelpers';
import { skipIfNoLiveLLM, seedLiveLLMSettings } from '@tests/e2e/helpers/liveTestHelpers';

/**
 * Live-LLM e2e: "Reprocess All" runs the real categorization service against a running
 * Ollama/LM Studio model. Skipped unless LIVE_LLM_URL is set. Complements the mocked-LLM
 * Reprocess coverage in tests/integration/transactionsPage.spec.ts (which checks the wiring);
 * this one checks that real categories actually come back and land on the rows.
 */

const INR = { code: 'INR', symbol: '₹', name: 'Indian Rupee' };

// Merchants with an obvious keyword/category signal so a real model has something to classify.
const LIVE_TXNS = [
  { id: 's1', date: '2024-01-10T00:00:00.000Z', description: 'SWIGGY FOOD ORDER', amount: 350, type: 'debit', category: 'other', localCurrency: INR, sourceType: 'bank' },
  { id: 's2', date: '2024-01-11T00:00:00.000Z', description: 'AMAZON PURCHASE', amount: 1299, type: 'debit', category: 'other', localCurrency: INR, sourceType: 'bank' },
  { id: 's3', date: '2024-01-12T00:00:00.000Z', description: 'NETFLIX SUBSCRIPTION', amount: 649, type: 'debit', category: 'other', localCurrency: INR, sourceType: 'bank' },
];

async function seedUncategorized(context: BrowserContext) {
  const payload = JSON.stringify({
    state: { transactions: LIVE_TXNS, selectedIds: [], isCategorizing: false, categorizeProgress: '' },
    version: 0,
  });
  await context.addInitScript((data: string) => {
    localStorage.setItem('transaction-storage', data);
  }, payload);
}

test.describe('Transactions Reprocess — Live LLM', () => {
  test.beforeEach(async ({ context }) => {
    skipIfNoLiveLLM();
    await clearAllStorage(context);
    await setupTestContext(context);
    await seedLiveLLMSettings(context);
  });

  test('Reprocess All recategorizes rows with real categories from the live model', async ({ page, context }) => {
    await seedUncategorized(context);
    await page.goto('/transactions');

    // All three rows are present and start uncategorized ('Other').
    await expect(page.locator('tbody tr')).toHaveCount(3);

    await page.getByRole('button', { name: /Reprocess All/ }).click();

    // Success only fires if recategorizeStoredTransactions resolved against the live model.
    await expect(page.getByText('Categorization complete')).toBeVisible({ timeout: 60000 });

    // No failure toast, and all three rows are still on screen after the recategorize.
    await expect(page.getByText('Categorization failed')).toHaveCount(0);
    await expect(page.locator('tbody tr')).toHaveCount(3);

    // At least one row moved off the placeholder 'Other' category — the live model returned
    // a real classification for a merchant with a clear signal.
    await expect(page.locator('tbody tr').getByRole('button', { name: 'Other', exact: true })).not.toHaveCount(3);
  });
});
