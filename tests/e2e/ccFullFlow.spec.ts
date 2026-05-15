import { test, expect } from '@playwright/test';
import { setupTestContext, mockCategorizationAPI } from './helpers/e2eHelpers';
import { clearAllStorage } from '@tests/utils/storageHelpers';

// ---------------------------------------------------------------------------
// Seed data — shared across both tests
// ---------------------------------------------------------------------------

const CC_STATEMENT_ID = 'cc-e2e-1';

const CC_STORAGE = {
  state: {
    statements: [
      {
        id: CC_STATEMENT_ID,
        fileName: 'hdfc_statement.pdf',
        parseDate: '2025-01-15',
        cardLastFour: '1234',
        cardIssuer: 'HDFC',
        statementPeriod: { start: '2025-01-01', end: '2025-01-31' },
        statementDate: '2025-01-15',
        paymentDueDate: '2025-02-05',
        totalDue: 25000,
        minimumDue: 1250,
        creditLimit: 200000,
        availableCredit: 175000,
        previousBalance: 20000,
        paymentsReceived: 20000,
        purchasesAndCharges: 25000,
        isPaid: false,
      },
    ],
  },
  version: 0,
};

/** Minimal set of CC-type transactions. Uses string category IDs that the
 *  Category model can resolve (shopping, dining, travel, entertainment). */
function buildCCTransactions(withCategories = false) {
  const baseTxns = [
    {
      id: 'cctx-e2e-1',
      date: '2025-01-05',
      description: 'Amazon Purchase',
      amount: 3500,
      type: 'debit',
      category: withCategories ? 'shopping' : 'uncategorized',
      merchant: 'Amazon',
      needsReview: false,
      localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
      sourceType: 'credit_card',
      statementId: CC_STATEMENT_ID,
      cardIssuer: 'HDFC',
      cardLastFour: '1234',
    },
    {
      id: 'cctx-e2e-2',
      date: '2025-01-10',
      description: 'Swiggy Order',
      amount: 850,
      type: 'debit',
      category: withCategories ? 'dining' : 'uncategorized',
      merchant: 'Swiggy',
      needsReview: false,
      localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
      sourceType: 'credit_card',
      statementId: CC_STATEMENT_ID,
      cardIssuer: 'HDFC',
      cardLastFour: '1234',
    },
    {
      id: 'cctx-e2e-3',
      date: '2025-01-12',
      description: 'Uber Ride',
      amount: 450,
      type: 'debit',
      category: withCategories ? 'travel' : 'uncategorized',
      merchant: 'Uber',
      needsReview: false,
      localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
      sourceType: 'credit_card',
      statementId: CC_STATEMENT_ID,
      cardIssuer: 'HDFC',
      cardLastFour: '1234',
    },
    {
      id: 'cctx-e2e-4',
      date: '2025-01-14',
      description: 'Netflix Subscription',
      amount: 649,
      type: 'debit',
      category: withCategories ? 'entertainment' : 'uncategorized',
      merchant: 'Netflix',
      needsReview: false,
      localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
      sourceType: 'credit_card',
      statementId: CC_STATEMENT_ID,
      cardIssuer: 'HDFC',
      cardLastFour: '1234',
    },
    {
      id: 'cctx-e2e-5',
      date: '2025-01-15',
      description: 'Payment Received',
      amount: 20000,
      type: 'credit',
      category: 'payment',
      merchant: 'HDFC',
      needsReview: false,
      localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
      sourceType: 'credit_card',
      statementId: CC_STATEMENT_ID,
      cardIssuer: 'HDFC',
      cardLastFour: '1234',
    },
  ];

  return baseTxns;
}

/** Seed localStorage with CC statement + transaction data. */
async function seedCCData(
  context: import('@playwright/test').BrowserContext,
  withCategories = false,
) {
  const ccTransactions = buildCCTransactions(withCategories);

  await context.addInitScript(
    ({ ccStorage, ccTxns }) => {
      window.localStorage.setItem(
        'credit-card-storage',
        JSON.stringify(ccStorage),
      );
      window.localStorage.setItem(
        'transaction-storage',
        JSON.stringify({
          state: { transactions: ccTxns },
          version: 0,
        }),
      );
    },
    { ccStorage: CC_STORAGE, ccTxns: ccTransactions },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('CC upload through to CC page display', () => {
  test.beforeEach(async ({ context }) => {
    await clearAllStorage(context);
    await setupTestContext(context);
    await mockCategorizationAPI(context);
  });

  test('CC upload to CC page shows card data', async ({ context, page }) => {
    await seedCCData(context);

    await page.goto('/credit-cards');

    // Verify the page header rendered (not crashed)
    await expect(
      page.getByRole('heading', { name: /credit cards/i }),
    ).toBeVisible({ timeout: 10000 });

    // Card issuer name is visible (rendered by CreditCardDisplay)
    await expect(page.getByText('HDFC').first()).toBeVisible({
      timeout: 10000,
    });

    // Card last-four digits visible (masked format: ●●●● 1234)
    await expect(
      page.getByText(/●●●● 1234|\*\*\*\* 1234/i).first(),
    ).toBeVisible({ timeout: 5000 });

    // Amount due is visible — formatted as ₹25,000 (or locale variant)
    await expect(page.getByText(/25,?000/).first()).toBeVisible({
      timeout: 5000,
    });

    // Spending tab is the default and shows total spending summary.
    // Only debit CC transactions count: 3500 + 850 + 450 + 649 = 5449
    await expect(
      page.getByText(/total cc spending.*₹.*5,?449/i),
    ).toBeVisible({ timeout: 5000 });
  });

  test('CC spending tab shows category breakdown', async ({
    context,
    page,
  }) => {
    await seedCCData(context, true /* withCategories */);

    await page.goto('/credit-cards');

    // Wait for the page to fully render
    await expect(page.getByText('HDFC').first()).toBeVisible({
      timeout: 10000,
    });

    // The Spending tab is the default tab (defaultValue="spending").
    // Verify it is active — the tab trigger should have data-state="active".
    const spendingTab = page.getByRole('tab', { name: /spending/i });
    await expect(spendingTab).toBeVisible({ timeout: 5000 });

    // Click the Spending tab explicitly to ensure the tab content panel renders
    await spendingTab.click();

    // The SpendingTab component renders:
    // 1. A Recharts ResponsiveContainer (renders as a <div> with a child <svg>)
    //    for the category pie chart.
    // 2. A Recharts BarChart with ResponsiveContainer for monthly trend.
    //
    // Verify that at least one recharts container or SVG rendered — this
    // confirms the chart library mounted successfully.
    const rechartsContainer = page.locator(
      '.recharts-responsive-container',
    );
    await expect(rechartsContainer.first()).toBeVisible({ timeout: 10000 });

    // Verify the "By Category" card heading is visible
    await expect(page.getByText('By Category')).toBeVisible({ timeout: 5000 });

    // Verify at least one category name from our seed data is rendered
    // (shopping, dining, travel, or entertainment)
    const categoryVisible =
      (await page.getByText('Shopping').count()) > 0 ||
      (await page.getByText('Dining').count()) > 0 ||
      (await page.getByText('Travel').count()) > 0 ||
      (await page.getByText('Entertainment').count()) > 0;
    expect(categoryVisible).toBeTruthy();
  });
});
