import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { clearAllStorage } from '@tests/utils/storageHelpers';
import { setupTestContext, mockCategorizationAPI } from '@tests/e2e/helpers/e2eHelpers';

/**
 * Integration coverage for the Transactions page in isolation. Data is seeded straight into
 * the transaction-store's localStorage envelope; the LLM is mocked so no model is required.
 * Each flow carries a negative assertion.
 *
 * Row presence is asserted via a tbody-row locator scoped by text rather than getByText,
 * because a row can render its description in two spans (merchant + description) once a
 * merchant is set — getByText then goes ambiguous under strict mode.
 */

const INR = { code: 'INR', symbol: '₹', name: 'Indian Rupee' };

// A realistic mix spanning every filter axis: roles (expense/income/transfer), sources
// (bank/card), categories, an active anomaly, a dismissed anomaly, and a needs-review row.
function baseTransactions() {
  return [
    { id: 't1', date: '2024-01-10T00:00:00.000Z', description: 'Big Basket', amount: 2500, type: 'debit', category: 'groceries', localCurrency: INR, sourceType: 'bank' },
    { id: 't2', date: '2024-01-05T00:00:00.000Z', description: 'Acme Salary', amount: 50000, type: 'credit', category: 'income', localCurrency: INR, sourceType: 'bank' },
    { id: 't3', date: '2024-01-08T00:00:00.000Z', description: 'Transfer To Savings', amount: 1000, type: 'debit', transactionSubType: 'self_transfer', category: 'transfer', localCurrency: INR, sourceType: 'bank' },
    { id: 't4', date: '2024-01-15T00:00:00.000Z', description: 'Amazon Card Purchase', amount: 1299, type: 'debit', category: 'shopping', localCurrency: INR, sourceType: 'credit_card', isAnomaly: true },
    { id: 't5', date: '2024-01-12T00:00:00.000Z', description: 'Starbucks Coffee', amount: 250, type: 'debit', category: 'dining', localCurrency: INR, sourceType: 'bank', isAnomaly: true, anomalyDismissed: true },
    { id: 't6', date: '2024-01-20T00:00:00.000Z', description: 'Netflix Subscription', amount: 649, type: 'debit', category: 'entertainment', localCurrency: INR, sourceType: 'bank', reviewReasons: ['low_confidence'] },
  ];
}

async function seedTransactions(context: BrowserContext, transactions: ReturnType<typeof baseTransactions>) {
  const payload = JSON.stringify({
    state: { transactions, selectedIds: [], isCategorizing: false, categorizeProgress: '' },
    version: 0,
  });
  await context.addInitScript((data: string) => {
    localStorage.setItem('transaction-storage', data);
  }, payload);
}

const SEARCH_PLACEHOLDER = 'Search descriptions...';
// shadcn Select triggers render as role=combobox in DOM order: category, type, source.
const categorySelect = (page: Page) => page.getByRole('combobox').nth(0);
const typeSelect = (page: Page) => page.getByRole('combobox').nth(1);
const sourceSelect = (page: Page) => page.getByRole('combobox').nth(2);

/** Open a shadcn Select and pick an option, waiting for the option to mount first so the
 *  Radix popover-open doesn't race the click. */
async function choose(page: Page, trigger: ReturnType<typeof typeSelect>, option: string) {
  await trigger.click();
  const opt = page.getByRole('option', { name: option, exact: true });
  await expect(opt).toBeVisible({ timeout: 3000 });
  await opt.click();
}

/** A transaction row containing the given description text. */
const row = (page: Page, text: string) => page.locator('tbody tr').filter({ hasText: text });

/** Wait until the store has hydrated and a seeded row is on screen, so inputs are stable. */
async function waitForReady(page: Page, text: string) {
  await expect(row(page, text)).toBeVisible({ timeout: 10000 });
}

test.describe('Transactions page', () => {
  test.beforeEach(async ({ context }) => {
    await clearAllStorage(context);
    await setupTestContext(context);
    await mockCategorizationAPI(context);
  });

  test('renders seeded rows and the Showing footer', async ({ page, context }) => {
    await seedTransactions(context, baseTransactions());
    await page.goto('/transactions');

    await expect(row(page, 'Big Basket')).toBeVisible();
    await expect(row(page, 'Netflix Subscription')).toBeVisible();
    await expect(page.getByText(/Showing 6 of 6/)).toBeVisible();
  });

  test('search filters rows by description and hides non-matches', async ({ page, context }) => {
    await seedTransactions(context, baseTransactions());
    await page.goto('/transactions');
    await waitForReady(page, 'Big Basket');

    await page.getByPlaceholder(SEARCH_PLACEHOLDER).fill('amazon');

    await expect(row(page, 'Amazon Card Purchase')).toBeVisible();
    await expect(row(page, 'Big Basket')).toBeHidden();
  });

  test('type filter: Income shows only the salary row', async ({ page, context }) => {
    await seedTransactions(context, baseTransactions());
    await page.goto('/transactions');
    await waitForReady(page, 'Big Basket');

    await choose(page, typeSelect(page), 'Income');

    await expect(row(page, 'Acme Salary')).toBeVisible();
    await expect(row(page, 'Big Basket')).toBeHidden();
  });

  test('source filter: Credit Card shows only the card row', async ({ page, context }) => {
    await seedTransactions(context, baseTransactions());
    await page.goto('/transactions');
    await waitForReady(page, 'Big Basket');

    await choose(page, sourceSelect(page), 'Credit Card');

    await expect(row(page, 'Amazon Card Purchase')).toBeVisible();
    await expect(row(page, 'Big Basket')).toBeHidden();
  });

  test('category filter narrows to one category', async ({ page, context }) => {
    await seedTransactions(context, baseTransactions());
    await page.goto('/transactions');
    await waitForReady(page, 'Big Basket');

    await choose(page, categorySelect(page), 'Groceries');

    await expect(row(page, 'Big Basket')).toBeVisible();
    await expect(row(page, 'Acme Salary')).toBeHidden();
  });

  test('anomaly toggle shows only active anomalies; a dismissed one stays hidden', async ({ page, context }) => {
    await seedTransactions(context, baseTransactions());
    await page.goto('/transactions');
    await waitForReady(page, 'Big Basket');

    await page.getByRole('button', { name: /Anomalies/ }).click();

    await expect(row(page, 'Amazon Card Purchase')).toBeVisible();
    await expect(row(page, 'Starbucks Coffee')).toBeHidden(); // dismissed anomaly
    await expect(row(page, 'Big Basket')).toBeHidden(); // not an anomaly
  });

  test('dismissing the last active anomaly auto-clears the filter', async ({ page, context }) => {
    // Seed only the one active anomaly so dismissing it drives the count to zero.
    await seedTransactions(context, [baseTransactions()[3], baseTransactions()[0]]);
    await page.goto('/transactions');
    await waitForReady(page, 'Big Basket');

    await page.getByRole('button', { name: /Anomalies/ }).click();
    await expect(row(page, 'Big Basket')).toBeHidden();

    await page.getByRole('button', { name: 'Dismiss' }).click();

    // Filter auto-cleared: the non-anomaly row reappears.
    await expect(row(page, 'Big Basket')).toBeVisible();
  });

  test('needs-review toggle shows only rows carrying review reasons', async ({ page, context }) => {
    await seedTransactions(context, baseTransactions());
    await page.goto('/transactions');
    await waitForReady(page, 'Big Basket');

    await page.getByRole('button', { name: /Needs Review/ }).click();

    await expect(row(page, 'Netflix Subscription')).toBeVisible();
    await expect(row(page, 'Big Basket')).toBeHidden();
  });

  test('selection: row checkbox updates the count; select-all then Clear deselects', async ({ page, context }) => {
    await seedTransactions(context, baseTransactions());
    await page.goto('/transactions');
    await waitForReady(page, 'Big Basket');

    await page.getByRole('checkbox', { name: 'Select Big Basket' }).click();
    await expect(page.getByText(/1 selected/)).toBeVisible();

    await page.getByRole('checkbox', { name: 'Select all' }).click();
    await expect(page.getByText(/6 selected/)).toBeVisible();

    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(page.getByText(/selected/)).toHaveCount(0);
  });

  test('inline category change persists across reload', async ({ page }) => {
    // Seed via in-page localStorage (not addInitScript, which would re-run on reload and
    // clobber the change). Load once empty, set storage, then reload to hydrate.
    await page.goto('/transactions');
    await page.evaluate((txns) => {
      localStorage.setItem('transaction-storage', JSON.stringify({
        state: { transactions: txns, selectedIds: [], isCategorizing: false, categorizeProgress: '' },
        version: 0,
      }));
    }, baseTransactions());
    await page.reload();
    await waitForReady(page, 'Big Basket');

    // The row's category editor trigger is a button showing the current category name.
    await page.getByRole('button', { name: 'Groceries', exact: true }).click();
    // Pick a category no other seeded row currently holds, so the option is unambiguous.
    await page.getByRole('button', { name: 'Transportation', exact: true }).click();
    await expect(page.getByText('Category updated')).toBeVisible();

    await page.reload();

    // The change survived the persistence round-trip: the row's editor now shows Transportation.
    await expect(page.getByRole('button', { name: 'Transportation', exact: true })).toBeVisible();
  });

  test('Clear-filters resets an active search and then hides itself', async ({ page, context }) => {
    await seedTransactions(context, baseTransactions());
    await page.goto('/transactions');
    await waitForReady(page, 'Big Basket');

    await page.getByPlaceholder(SEARCH_PLACEHOLDER).fill('amazon');
    await expect(row(page, 'Big Basket')).toBeHidden();

    await page.getByRole('button', { name: 'Clear', exact: true }).click();

    // Search cleared → all rows back.
    await expect(row(page, 'Big Basket')).toBeVisible();
    await expect(row(page, 'Amazon Card Purchase')).toBeVisible();
  });

  test('?anomaly=true deep-link activates the anomaly filter on load', async ({ page, context }) => {
    await seedTransactions(context, baseTransactions());
    await page.goto('/transactions?anomaly=true');

    await expect(row(page, 'Amazon Card Purchase')).toBeVisible();
    await expect(row(page, 'Big Basket')).toBeHidden();
  });

  test('empty state copy differs by filter state', async ({ page, context }) => {
    await seedTransactions(context, []);
    await page.goto('/transactions');

    await expect(page.getByText('No transactions yet')).toBeVisible();

    await page.getByPlaceholder(SEARCH_PLACEHOLDER).fill('nothing');
    await expect(page.getByText('No transactions match your filters')).toBeVisible();
  });

  test('Reprocess All recategorizes and clears selection (mocked LLM)', async ({ page, context }) => {
    await seedTransactions(context, baseTransactions());
    await page.goto('/transactions');
    await waitForReady(page, 'Big Basket');

    await page.getByRole('checkbox', { name: 'Select Big Basket' }).click();
    await expect(page.getByText(/1 selected/)).toBeVisible();

    await page.getByRole('button', { name: /Reprocess All/ }).click();

    await expect(page.getByText('Categorization complete')).toBeVisible({ timeout: 20000 });
    // Selection is cleared in the recategorize finally block.
    await expect(page.getByText(/selected/)).toHaveCount(0);
    // All six rows remain after recategorization.
    await expect(page.locator('tbody tr')).toHaveCount(6);
  });
});
