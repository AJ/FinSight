import { test, expect } from '@playwright/test';
import { setupTestContext, mockCategorizationAPI } from '../e2e/helpers/e2eHelpers';
import { clearAllStorage } from '../utils/storageHelpers';

test.describe('Review page — balance reconciliation', () => {
  test.beforeEach(async ({ context }) => {
    await clearAllStorage(context);
    await setupTestContext(context);
    await mockCategorizationAPI(context);
  });

  test('shows reconciliation failure when closing balance does not match', async ({ page, context }) => {
    await context.addInitScript(() => {
      window.sessionStorage.setItem('review-session-v1', JSON.stringify({
        transactions: [
          { id: 't1', date: '2024-01-05', description: 'Opening Deposit', amount: 50000, type: 'credit', category: 'income', merchant: 'Bank', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
          { id: 't2', date: '2024-01-10', description: 'Rent Payment', amount: 15000, type: 'debit', category: 'housing', merchant: 'Landlord', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
          { id: 't3', date: '2024-01-20', description: 'Grocery Store', amount: 3000, type: 'debit', category: 'groceries', merchant: 'BigBasket', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
        ],
        currency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
        format: 'pdf',
        statementType: 'bank',
        fileName: 'bank_statement.pdf',
        parseDate: new Date().toISOString(),
        warnings: ['Bank statement verification failed: balance reconciliation difference 32000.00'],
        verificationReport: {
          verified: [
            { id: 't1', date: '2024-01-05', description: 'Opening Deposit', amount: 50000, type: 'credit', category: 'income', merchant: 'Bank', needsReview: false, confidence: 95, verification: { amountMatched: true, dateMatched: true, descriptionMatched: true, contextMatched: true, currencyMatched: true } },
            { id: 't2', date: '2024-01-10', description: 'Rent Payment', amount: 15000, type: 'debit', category: 'housing', merchant: 'Landlord', needsReview: false, confidence: 90, verification: { amountMatched: true, dateMatched: true, descriptionMatched: true, contextMatched: true, currencyMatched: true } },
            { id: 't3', date: '2024-01-20', description: 'Grocery Store', amount: 3000, type: 'debit', category: 'groceries', merchant: 'BigBasket', needsReview: false, confidence: 88, verification: { amountMatched: true, dateMatched: true, descriptionMatched: true, contextMatched: true, currencyMatched: true } },
          ],
          rejected: [],
          duplicates: [],
          reconciliation: {
            passed: false,
            computedClosing: 32000,
            expectedClosing: 35000,
            difference: 3000,
          },
          overallConfidence: 60,
        },
        sourceMetadata: {},
      }));
    });

    await page.goto('/review');
    await expect(page).toHaveURL(/\/review/);

    // Verification summary should be visible (confidence < 80, reconciliation failed)
    const summary = page.locator('text=Verification Failed');
    await expect(summary).toBeVisible({ timeout: 10000 });

    // Click to expand
    await summary.click();

    // Reconciliation section should show failure
    await expect(page.getByText('Reconciliation', { exact: true })).toBeVisible();
    await expect(page.getByText(/extracted vs.*expected/)).toBeVisible();

    // Confidence badge should show
    await expect(page.getByText('60%')).toBeVisible();

    // Transactions should still render
    await expect(page.getByText('Opening Deposit').first()).toBeVisible();
    await expect(page.getByText('Rent Payment').first()).toBeVisible();
    await expect(page.getByText('Grocery Store').first()).toBeVisible();
  });

  test('hides verification summary when reconciliation passes with high confidence', async ({ page, context }) => {
    await context.addInitScript(() => {
      window.sessionStorage.setItem('review-session-v1', JSON.stringify({
        transactions: [
          { id: 't1', date: '2024-01-05', description: 'Salary Credit', amount: 50000, type: 'credit', category: 'income', merchant: 'Employer', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
          { id: 't2', date: '2024-01-10', description: 'Rent Payment', amount: 15000, type: 'debit', category: 'housing', merchant: 'Landlord', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
        ],
        currency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
        format: 'pdf',
        statementType: 'bank',
        fileName: 'bank_statement.pdf',
        parseDate: new Date().toISOString(),
        warnings: [],
        verificationReport: {
          verified: [
            { id: 't1', date: '2024-01-05', description: 'Salary Credit', amount: 50000, type: 'credit', confidence: 95, verification: { amountMatched: true, dateMatched: true, descriptionMatched: true, contextMatched: true, currencyMatched: true } },
            { id: 't2', date: '2024-01-10', description: 'Rent Payment', amount: 15000, type: 'debit', confidence: 92, verification: { amountMatched: true, dateMatched: true, descriptionMatched: true, contextMatched: true, currencyMatched: true } },
          ],
          rejected: [],
          duplicates: [],
          reconciliation: {
            passed: true,
            computedClosing: 35000,
            expectedClosing: 35000,
            difference: 0,
          },
          overallConfidence: 93,
        },
        sourceMetadata: {},
      }));
    });

    await page.goto('/review');
    await expect(page).toHaveURL(/\/review/);

    // Transactions should render
    await expect(page.getByText('Salary Credit').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Rent Payment').first()).toBeVisible();

    // Verification summary should NOT be visible (passed + confidence >= 80)
    await expect(page.locator('text=Verification')).not.toBeVisible();
  });

  test('shows CC verification failure when statement totals do not match', async ({ page, context }) => {
    await context.addInitScript(() => {
      window.sessionStorage.setItem('review-session-v1', JSON.stringify({
        transactions: [
          { id: 'c1', date: '2024-01-05', description: 'AMAZON PURCHASE', amount: 5000, type: 'debit', category: 'shopping', merchant: 'AMAZON', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'credit_card' },
          { id: 'c2', date: '2024-01-15', description: 'PAYMENT RECEIVED', amount: 10000, type: 'credit', category: 'payment', merchant: 'BANK', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'credit_card' },
        ],
        currency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
        format: 'pdf',
        statementType: 'credit_card',
        fileName: 'cc_statement.pdf',
        parseDate: new Date().toISOString(),
        warnings: ['Credit card statement verification failed: totals or transaction sums do not fully reconcile.'],
        verificationReport: {
          statementTotals: {
            passed: false,
            expectedTotalDue: 25000,
            computedTotalDue: 20000,
            difference: 5000,
            formula: 'Previous(30000) + Debits(5000) - Credits(10000) = 25000',
          },
          transactionSums: {
            passed: true,
            totalPurchases: 5000,
            totalPayments: 10000,
            totalFees: 0,
            totalDebits: 5000,
            totalCredits: 10000,
          },
          overallConfidence: 55,
          passed: false,
        },
        sourceMetadata: {},
      }));
    });

    await page.goto('/review');
    await expect(page).toHaveURL(/\/review/);

    // Verification summary visible (low confidence)
    const summary = page.locator('text=Verification Failed');
    await expect(summary).toBeVisible({ timeout: 10000 });

    // Expand
    await summary.click();

    // Balance Match should show failure
    await expect(page.getByText('Balance Match')).toBeVisible();

    // CC transactions render
    await expect(page.getByText('AMAZON PURCHASE').first()).toBeVisible();
    await expect(page.getByText('PAYMENT RECEIVED').first()).toBeVisible();
  });

  test('renders flagged transactions count when verification rejects some', async ({ page, context }) => {
    await context.addInitScript(() => {
      window.sessionStorage.setItem('review-session-v1', JSON.stringify({
        transactions: [
          { id: 't1', date: '2024-01-05', description: 'Valid Txn', amount: 5000, type: 'debit', category: 'shopping', merchant: 'AMAZON', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
          { id: 't2', date: '2024-01-10', description: 'Another Valid', amount: 3000, type: 'debit', category: 'food', merchant: 'SWIGGY', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
        ],
        currency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
        format: 'pdf',
        statementType: 'bank',
        fileName: 'bank_statement.pdf',
        parseDate: new Date().toISOString(),
        warnings: ['Bank statement verification failed: balance reconciliation difference 2000.'],
        verificationReport: {
          verified: [
            { id: 't1', date: '2024-01-05', description: 'Valid Txn', amount: 5000, type: 'debit', confidence: 90, verification: { amountMatched: true, dateMatched: true, descriptionMatched: true, contextMatched: true, currencyMatched: true } },
          ],
          rejected: [
            { id: 't2', date: '2024-01-10', description: 'Another Valid', amount: 3000, type: 'debit', category: 'food', merchant: 'SWIGGY', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
          ],
          duplicates: [],
          reconciliation: {
            passed: false,
            computedClosing: 28000,
            expectedClosing: 30000,
            difference: 2000,
          },
          overallConfidence: 45,
        },
        sourceMetadata: {},
      }));
    });

    await page.goto('/review');
    await expect(page).toHaveURL(/\/review/);

    const summary = page.locator('text=Verification Failed');
    await expect(summary).toBeVisible({ timeout: 10000 });
    await summary.click();

    // Flagged transactions count
    await expect(page.getByText('Flagged Transactions')).toBeVisible();

    // Both transactions render (verified + rejected both in the table)
    await expect(page.getByText('Valid Txn').first()).toBeVisible();
    await expect(page.getByText('Another Valid').first()).toBeVisible();
  });
});
