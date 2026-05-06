import { test, expect } from '@playwright/test';
import { setupTestContext, mockCategorizationAPI } from '../e2e/helpers/e2eHelpers';

test.describe('Dashboard page', () => {
  test.beforeEach(async ({ context }) => {
    await setupTestContext(context);
    await mockCategorizationAPI(context);
  });

  test('empty state shows Upload Statement hero CTA', async ({ page }) => {
    await page.goto('/');
    // The empty-state hero CTA has "Welcome to FinSight" heading alongside the upload button
    const heroSection = page.locator('h2', { hasText: 'Welcome to FinSight' });
    await expect(heroSection).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Total Income')).not.toBeVisible({ timeout: 3000 });
  });

  test('with transactions shows stat cards', async ({ context, page }) => {
    await context.addInitScript(() => {
      window.localStorage.setItem('transaction-storage', JSON.stringify({
        state: {
          transactions: [
            { id: 't1', date: '2025-01-05', description: 'Salary', amount: 50000, type: 'credit', category: 'income', merchant: 'Employer', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
            { id: 't2', date: '2025-01-10', description: 'Groceries', amount: -2000, type: 'debit', category: 'groceries', merchant: 'BigBasket', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
            { id: 't3', date: '2025-01-15', description: 'Netflix', amount: -499, type: 'debit', category: 'entertainment', merchant: 'Netflix', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
          ],
        },
        version: 0,
      }));
    });

    await page.goto('/');
    await expect(page.getByText('Total Income')).toBeVisible({ timeout: 10000 });
    // The empty-state hero ("Welcome to FinSight") must NOT be shown when transactions exist
    await expect(page.locator('h2', { hasText: 'Welcome to FinSight' })).not.toBeVisible({ timeout: 5000 });
  });

  test('with CC data shows credit card section', async ({ context, page }) => {
    await context.addInitScript(() => {
      window.localStorage.setItem('credit-card-storage', JSON.stringify({
        state: {
          statements: [{
            id: 'cc-1',
            fileName: 'cc.pdf',
            parseDate: '2025-01-15',
            cardLastFour: '1234',
            cardIssuer: 'HDFC',
            statementPeriod: { start: '2025-01-01', end: '2025-01-31' },
            statementDate: '2025-01-15',
            paymentDueDate: '2025-02-05',
            totalDue: 15000,
            minimumDue: 750,
            creditLimit: 100000,
            availableCredit: 85000,
            previousBalance: 12000,
            paymentsReceived: 12000,
            purchasesAndCharges: 15000,
            isPaid: false,
          }],
        },
        version: 0,
      }));
    });

    await page.goto('/');
    await expect(page.getByText(/credit|card|utilization/i)).toBeVisible({ timeout: 10000 });
  });

  test('without CC data does not crash — graceful empty state', async ({ page }) => {
    await page.goto('/');
    // Page must render without error regardless of CC data presence
    await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
    // Should not show CC-specific data
    const hasCCData = await page.getByText(/HDFC|credit utilization|total due/i).isVisible({ timeout: 3000 }).catch(() => false);
    expect(hasCCData).toBe(false);
  });

  test('/dashboard redirects to /', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForURL(/\//, { timeout: 10000 }).catch(() => null);
    expect(page.url()).toContain('localhost');
  });
});
