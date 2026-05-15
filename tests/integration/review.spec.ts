import { test, expect } from '@playwright/test';
import { setupTestContext, mockCategorizationAPI } from '../e2e/helpers/e2eHelpers';

test.describe('Review page', () => {
  test.beforeEach(async ({ context }) => {
    await setupTestContext(context);
    await mockCategorizationAPI(context);
  });

  test('no session data redirects to home', async ({ page }) => {
    await page.goto('/review');
    await page.waitForURL((url) => !url.pathname.includes('/review'), { timeout: 10000 }).catch(() => null);
    expect(page.url()).not.toContain('/review');
  });

  test('with session data shows pending transactions table', async ({ context, page }) => {
    await context.addInitScript(() => {
      window.sessionStorage.setItem('review-session-v1', JSON.stringify({
        transactions: [
          { id: 'rt1', date: '2025-01-05', description: 'Groceries', amount: -2000, type: 'debit', category: 'groceries', merchant: 'Store', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
          { id: 'rt2', date: '2025-01-10', description: 'Netflix', amount: -499, type: 'debit', category: 'entertainment', merchant: 'Netflix', needsReview: true, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
        ],
        sourceFile: 'test.csv',
        importTimestamp: new Date().toISOString(),
      }));
    });

    await page.goto('/review');
    await expect(page.getByText('Groceries').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Netflix').first()).toBeVisible();
    // Should NOT redirect since we have valid session data
    expect(page.url()).toContain('/review');
  });

  test('export CSV triggers download with correct content', async ({ context, page }) => {
    await context.addInitScript(() => {
      window.sessionStorage.setItem('review-session-v1', JSON.stringify({
        transactions: [
          { id: 're-1', date: '2025-01-05T00:00:00.000Z', description: 'Test Transaction', amount: 100, type: 'debit', category: 'shopping', merchant: 'Test Merchant', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
        ],
        currency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
        format: 'csv',
        statementType: 'bank',
        fileName: 'test.csv',
        parseDate: new Date().toISOString(),
        warnings: [],
      }));
    });

    await page.goto('/review');
    await expect(page.getByText('Test Transaction').first()).toBeVisible({ timeout: 10000 });

    const exportBtn = page.getByRole('button', { name: /export csv/i });
    await expect(exportBtn).toBeVisible({ timeout: 5000 });

    // Click Export CSV and wait for the download
    const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
    await exportBtn.click();
    const download = await downloadPromise;

    // Verify download was triggered
    expect(download).toBeTruthy();
    const suggestedFilename = download.suggestedFilename();
    expect(suggestedFilename).toMatch(/transactions.*\.csv$/);

    // Verify CSV content contains our transaction
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    const csvContent = Buffer.concat(chunks).toString('utf-8');
    expect(csvContent).toContain('Date');
    expect(csvContent).toContain('Test Transaction');
  });

  test('cancel clears session and redirects to home', async ({ context, page }) => {
    await context.addInitScript(() => {
      window.sessionStorage.setItem('review-session-v1', JSON.stringify({
        transactions: [
          { id: 'rt1', date: '2025-01-05', description: 'Test Txn', amount: -100, type: 'debit', category: 'other', merchant: 'Test', needsReview: false, localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, sourceType: 'bank' },
        ],
        sourceFile: 'test.csv',
        importTimestamp: new Date().toISOString(),
      }));
    });

    await page.goto('/review');
    await expect(page.getByText('Test Txn')).toBeVisible({ timeout: 10000 });

    const cancelBtn = page.getByRole('button', { name: /cancel|discard|back/i });
    await expect(cancelBtn).toBeVisible({ timeout: 5000 });
    await cancelBtn.click();
    await page.waitForURL((url) => !url.pathname.includes('/review'), { timeout: 10000 }).catch(() => null);

    // Session must be cleared
    const session = await page.evaluate(() => sessionStorage.getItem('review-session-v1'));
    expect(session).toBeNull();
    // Must have navigated away from /review
    expect(page.url()).not.toContain('/review');
  });
});

test.describe('Category Editing on Review Page', () => {
  test.beforeEach(async ({ context }) => {
    await setupTestContext(context);
    await mockCategorizationAPI(context);
  });

  test('category dropdown changes transaction category', async ({ context, page }) => {
    await context.addInitScript(() => {
      window.sessionStorage.setItem('review-session-v1', JSON.stringify({
        transactions: [
          {
            id: 'rt-1',
            date: '2025-01-05',
            description: 'AMAZON Purchase',
            amount: -2500,
            type: 'debit',
            category: 'shopping',
            merchant: 'AMAZON',
            needsReview: true,
            localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
            sourceType: 'bank',
          },
        ],
        sourceFile: 'test.csv',
        importTimestamp: new Date().toISOString(),
      }));
    });

    await page.goto('/review');
    await expect(page.getByText('AMAZON Purchase').first()).toBeVisible({ timeout: 10000 });

    // Verify initial category is displayed (Shopping)
    await expect(page.getByText('Shopping').first()).toBeVisible();

    // Click the edit button in the transaction row
    const row = page.locator('tr').filter({ hasText: 'AMAZON Purchase' });
    const editButton = row.locator('button').first();
    await editButton.click();

    // Wait for the edit dialog to appear
    await expect(page.getByRole('heading', { name: 'Edit Transaction' })).toBeVisible({ timeout: 5000 });

    // Change category from Shopping to Dining using the select
    const categorySelect = page.locator('#edit-category');
    await expect(categorySelect).toBeVisible();
    await categorySelect.selectOption('dining');

    // Click Save to apply the change
    const saveButton = page.getByRole('button', { name: 'Save' });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    // Verify the category badge updated to "Dining"
    await expect(page.getByText('Dining').first()).toBeVisible({ timeout: 5000 });

    // Verify the original category "Shopping" is no longer displayed in the table
    const categoryCells = page.locator('td').filter({ hasText: 'Shopping' });
    await expect(categoryCells).toHaveCount(0);
  });

  test('changed category persists in page state after edit', async ({ context, page }) => {
    await context.addInitScript(() => {
      window.sessionStorage.setItem('review-session-v1', JSON.stringify({
        transactions: [
          {
            id: 'rt-1',
            date: '2025-01-05',
            description: 'AMAZON Purchase',
            amount: -2500,
            type: 'debit',
            category: 'shopping',
            merchant: 'AMAZON',
            needsReview: true,
            localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
            sourceType: 'bank',
          },
        ],
        sourceFile: 'test.csv',
        importTimestamp: new Date().toISOString(),
      }));
    });

    await page.goto('/review');
    await expect(page.getByText('AMAZON Purchase').first()).toBeVisible({ timeout: 10000 });

    // Open the edit dialog via the first button in the transaction row
    const row = page.locator('tr').filter({ hasText: 'AMAZON Purchase' });
    await row.locator('button').first().click();
    await expect(page.getByRole('heading', { name: 'Edit Transaction' })).toBeVisible({ timeout: 5000 });

    // Change category to Transportation
    const categorySelect = page.locator('#edit-category');
    await categorySelect.selectOption('transportation');

    // Save the edit
    const saveButton = page.getByRole('button', { name: 'Save' });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    // Verify the UI reflects the new category
    await expect(page.getByText('Transportation').first()).toBeVisible({ timeout: 5000 });

    // Open the edit dialog again to confirm the change persisted in page state
    const updatedRow = page.locator('tr').filter({ hasText: 'AMAZON Purchase' });
    await updatedRow.locator('button').first().click();
    await expect(page.getByRole('heading', { name: 'Edit Transaction' })).toBeVisible({ timeout: 5000 });

    // The category select should now show "transportation" as its value
    const categorySelectAgain = page.locator('#edit-category');
    await expect(categorySelectAgain).toHaveValue('transportation');

    // Close the dialog without saving (use Escape to avoid ambiguity with header Cancel button)
    await page.keyboard.press('Escape');
  });
});
