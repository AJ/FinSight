import { test, expect, BrowserContext } from '@playwright/test';
import { setupTestContext, mockCategorizationAPI } from '../e2e/helpers/e2eHelpers';

test.describe('Transactions page', () => {
  test.beforeEach(async ({ context }) => {
    await setupTestContext(context);
    await mockCategorizationAPI(context);
  });

  test('empty state shows "No transactions yet" placeholder row', async ({ page }) => {
    await page.goto('/transactions');
    // Table always renders — empty state is a single placeholder row
    await expect(page.getByText('No transactions yet')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('tbody tr')).toHaveCount(1);
  });

  test('with transactions renders table rows', async ({ context, page }) => {
    await context.addInitScript(() => {
      window.localStorage.setItem('transaction-storage', JSON.stringify({
        state: {
          transactions: [
            { id: 't1', date: '2025-01-05', description: 'Salary Credit', amount: 50000, type: 'credit', category: 'income', merchant: 'Employer', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
            { id: 't2', date: '2025-01-10', description: 'Amazon Purchase', amount: -2500, type: 'debit', category: 'shopping', merchant: 'Amazon', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
          ],
        },
        version: 0,
      }));
    });

    await page.goto('/transactions');
    await expect(page.getByText('Salary Credit')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Amazon Purchase')).toBeVisible();
    // Should have exactly 2 data rows
    const rows = page.locator('tbody tr');
    await expect(rows).toHaveCount(2, { timeout: 5000 });
  });

  test('search filters transactions by description — excluded row must disappear', async ({ context, page }) => {
    await context.addInitScript(() => {
      window.localStorage.setItem('transaction-storage', JSON.stringify({
        state: {
          transactions: [
            { id: 't1', date: '2025-01-05', description: 'Salary Credit', amount: 50000, type: 'credit', category: 'income', merchant: 'Employer', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
            { id: 't2', date: '2025-01-10', description: 'Amazon Purchase', amount: -2500, type: 'debit', category: 'shopping', merchant: 'Amazon', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
          ],
        },
        version: 0,
      }));
    });

    await page.goto('/transactions');
    await expect(page.getByText('Salary Credit')).toBeVisible({ timeout: 10000 });

    const searchInput = page.getByPlaceholder(/search|filter/i);
    await expect(searchInput).toBeVisible({ timeout: 5000 });
    await searchInput.fill('Amazon');

    // Amazon must be visible, Salary must NOT
    await expect(page.getByText('Amazon Purchase')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Salary Credit')).not.toBeVisible();
  });

  test('search with no match shows empty state', async ({ context, page }) => {
    await context.addInitScript(() => {
      window.localStorage.setItem('transaction-storage', JSON.stringify({
        state: {
          transactions: [
            { id: 't1', date: '2025-01-05', description: 'Salary Credit', amount: 50000, type: 'credit', category: 'income', merchant: 'Employer', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
          ],
        },
        version: 0,
      }));
    });

    await page.goto('/transactions');
    await expect(page.getByText('Salary Credit')).toBeVisible({ timeout: 10000 });

    const searchInput = page.getByPlaceholder(/search|filter/i);
    await expect(searchInput).toBeVisible({ timeout: 5000 });
    await searchInput.fill('ZZZZNONEXISTENT');

    // Salary must be filtered out
    await expect(page.getByText('Salary Credit')).not.toBeVisible({ timeout: 5000 });
    // Table shows filtered empty state — exactly 1 placeholder row
    await expect(page.getByText('No transactions match your filters')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('tbody tr')).toHaveCount(1);
  });

  test('category filter dropdown filters results', async ({ context, page }) => {
    await context.addInitScript(() => {
      window.localStorage.setItem('transaction-storage', JSON.stringify({
        state: {
          transactions: [
            { id: 't1', date: '2025-01-05', description: 'Groceries', amount: -1000, type: 'debit', category: 'groceries', merchant: 'Store', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
            { id: 't2', date: '2025-01-10', description: 'Netflix', amount: -499, type: 'debit', category: 'entertainment', merchant: 'Netflix', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
          ],
        },
        version: 0,
      }));
    });

    await page.goto('/transactions');
    await expect(page.getByText('Groceries').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Netflix').first()).toBeVisible();

    // shadcn Select uses combobox role — find the category-specific one
    const categoryFilter = page.getByRole('combobox', { name: /all categories/i }).or(page.getByRole('combobox').filter({ hasText: 'All Categories' }));
    await expect(categoryFilter).toBeVisible({ timeout: 5000 });
    await categoryFilter.click();

    // Wait for the Radix Select portal to open, then click the Groceries option
    const groceriesOption = page.getByRole('option', { name: /groceries/i });
    await expect(groceriesOption).toBeVisible({ timeout: 5000 });
    await groceriesOption.click();

    await expect(page.getByText('Groceries').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Netflix').first()).not.toBeVisible({ timeout: 5000 });
  });
});
