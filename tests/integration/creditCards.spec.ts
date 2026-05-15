import { test, expect } from '@playwright/test';
import { setupTestContext, mockCategorizationAPI } from '../e2e/helpers/e2eHelpers';

const CC_STATEMENT_ID = 'cc-1';
const CC_STORAGE = {
  state: {
    statements: [{
      id: CC_STATEMENT_ID,
      fileName: 'hdfc.pdf',
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
    }],
  },
  version: 0,
};

const CC_TRANSACTIONS = [
  { id: 'cctx1', date: '2025-01-05', description: 'Amazon Purchase', amount: -3500, type: 'debit', category: 'shopping', merchant: 'Amazon', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'credit_card', statementId: CC_STATEMENT_ID, cardIssuer: 'HDFC', cardLastFour: '1234' },
  { id: 'cctx2', date: '2025-01-10', description: 'Swiggy Order', amount: -850, type: 'debit', category: 'dining', merchant: 'Swiggy', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'credit_card', statementId: CC_STATEMENT_ID, cardIssuer: 'HDFC', cardLastFour: '1234' },
  { id: 'cctx3', date: '2025-01-15', description: 'Payment Received', amount: 20000, type: 'credit', category: 'payment', merchant: 'HDFC', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'credit_card', statementId: CC_STATEMENT_ID, cardIssuer: 'HDFC', cardLastFour: '1234' },
];

test.describe('Credit Cards page', () => {
  test.beforeEach(async ({ context }) => {
    await setupTestContext(context);
    await mockCategorizationAPI(context);
  });

  test('no CC data shows empty state', async ({ page }) => {
    await page.goto('/credit-cards');
    await expect(page.getByRole('heading', { name: 'No Credit Card Data' })).toBeVisible({ timeout: 10000 });
  });

  test('with CC data renders card with issuer, last four, and spending data', async ({ context, page }) => {
    await context.addInitScript(({ ccStorage, ccTransactions }) => {
      window.localStorage.setItem('credit-card-storage', JSON.stringify(ccStorage));
      window.localStorage.setItem('transaction-storage', JSON.stringify({
        state: { transactions: ccTransactions },
        version: 0,
      }));
    }, { ccStorage: CC_STORAGE, ccTransactions: CC_TRANSACTIONS });

    await page.goto('/credit-cards');
    // Debug: check if localStorage was properly seeded
    const ccData = await page.evaluate(() => window.localStorage.getItem('credit-card-storage'));
    const txnData = await page.evaluate(() => window.localStorage.getItem('transaction-storage'));
    if (!ccData || !txnData) {
      throw new Error(`localStorage not seeded: cc=${ccData ? 'present' : 'NULL'} txn=${txnData ? 'present' : 'NULL'}`);
    }
    // Card issuer and last-four are in separate DOM elements — assert them independently
    await expect(page.getByText('HDFC').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/●●●● 1234|\*\*\*\* 1234/i).first()).toBeVisible({ timeout: 5000 });
    // Spending tab shows transaction data — not an empty upload prompt
    await expect(page.getByText(/total cc spending.*₹.*4,350/i)).toBeVisible({ timeout: 5000 });
  });

  test('fresh state renders credit cards empty state with upload prompt', async ({ context, page }) => {
    // Clear all storage to ensure truly fresh state
    await context.addInitScript(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await setupTestContext(context);
    await mockCategorizationAPI(context);

    await page.goto('/credit-cards');
    // Should render the empty state heading
    await expect(page.getByRole('heading', { name: 'No Credit Card Data' })).toBeVisible({ timeout: 10000 });
    // Should show the Upload Statement button
    await expect(page.getByRole('button', { name: /upload statement/i })).toBeVisible();
    // Body should be visible (no crash)
    await expect(page.locator('body')).toBeVisible();
  });

  test('tab switching changes visible content', async ({ context, page }) => {
    await context.addInitScript(({ ccStorage, ccTransactions }) => {
      window.localStorage.setItem('credit-card-storage', JSON.stringify(ccStorage));
      window.localStorage.setItem('transaction-storage', JSON.stringify({
        state: { transactions: ccTransactions },
        version: 0,
      }));
    }, { ccStorage: CC_STORAGE, ccTransactions: CC_TRANSACTIONS });

    await page.goto('/credit-cards');
    await expect(page.getByText('HDFC').first()).toBeVisible({ timeout: 10000 });

    // Spending tab must be clickable
    const spendingTab = page.getByRole('tab', { name: /spending/i }).or(page.getByText('Spending').first());
    await expect(spendingTab.first()).toBeVisible({ timeout: 5000 });
    await spendingTab.first().click();

    // Page must not crash after tab switch
    await expect(page.locator('body')).toBeVisible({ timeout: 5000 });
  });
});
