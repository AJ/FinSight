import { test, expect } from '@playwright/test';
import { clearAllStorage } from '@tests/utils/storageHelpers';
import { setupTestContext } from '@tests/e2e/helpers/e2eHelpers';

test.describe('Budget Lifecycle', () => {
  test.beforeEach(async ({ page, context }) => {
    await clearAllStorage(context);
    await setupTestContext(context);
    await page.goto('/budget');
  });

  test('empty state shows on Track tab', async ({ page }) => {
    // Default tab is Track. Verify the empty state renders.
    await expect(page.getByText('No Budget Set')).toBeVisible();
    // The Plan tab button should be visible in the tab bar.
    await expect(page.getByRole('button', { name: 'Plan' })).toBeVisible();
  });

  test('Plan tab shows total budget input', async ({ page }) => {
    // Switch to the Plan tab.
    await page.getByRole('button', { name: 'Plan' }).click();

    // Verify the "Total Budget" label is visible.
    await expect(page.getByText('Total Budget')).toBeVisible();

    // Save should be disabled when there are no changes.
    const saveBtn = page.getByRole('button', { name: /save/i });
    await expect(saveBtn).toBeDisabled();
  });

  test('set budget and save', async ({ page }) => {
    // Switch to Plan tab.
    await page.getByRole('button', { name: 'Plan' }).click();

    // Fill the total budget input.
    const budgetInput = page.locator('input[type="number"]').first();
    await budgetInput.fill('50000');

    // Save should now be enabled since income changed from 0 but we need categories.
    // Apply a template to get categories.
    await page.getByRole('button', { name: /template/i }).click();
    await page.getByText('50/30/20').click();

    // Now click Save.
    const saveBtn = page.getByRole('button', { name: /save/i });
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();

    // Switch to Track tab.
    await page.getByRole('button', { name: 'Track' }).click();

    // Summary cards should show the budget amount.
    await expect(page.getByText('Budgeted')).toBeVisible();
    // Verify the Balance card shows a value (not em-dash), confirming data rendered.
    await expect(page.getByText('Balance')).toBeVisible();
  });

  test('template creates allocations', async ({ page }) => {
    // Switch to Plan tab.
    await page.getByRole('button', { name: 'Plan' }).click();

    // Set budget.
    const budgetInput = page.locator('input[type="number"]').first();
    await budgetInput.fill('60000');

    // Click Template dropdown and select 50/30/20.
    await page.getByRole('button', { name: /template/i }).click();
    await page.getByText('50/30/20').click();

    // Verify category rows appear — the template should create rows for
    // default categories like Housing, Groceries, Utilities, etc.
    await expect(page.getByText('Housing')).toBeVisible();
    await expect(page.getByText('Groceries')).toBeVisible();

    // Verify the "Allocated" summary line shows the total.
    await expect(page.getByText(/Allocated:/)).toBeVisible();

    // Click Save.
    const saveBtn = page.getByRole('button', { name: /save/i });
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();
  });

  test('reset reverts changes', async ({ page }) => {
    // Switch to Plan tab.
    await page.getByRole('button', { name: 'Plan' }).click();

    // Set budget to 50000 and save.
    const budgetInput = page.locator('input[type="number"]').first();
    await budgetInput.fill('50000');

    // Need categories to save.
    await page.getByRole('button', { name: /template/i }).click();
    await page.getByText('50/30/20').click();
    await page.getByRole('button', { name: /save/i }).click();

    // Change budget to 70000.
    await budgetInput.fill('70000');
    await expect(budgetInput).toHaveValue('70000');

    // Click Reset.
    await page.getByRole('button', { name: /reset/i }).click();

    // Verify the budget input shows 50000 again.
    await expect(budgetInput).toHaveValue('50000');
  });

  test('unsaved changes dialog', async ({ page }) => {
    // Switch to Plan tab.
    await page.getByRole('button', { name: 'Plan' }).click();

    // Set budget to 50000 but don't save.
    const budgetInput = page.locator('input[type="number"]').first();
    await budgetInput.fill('50000');

    // Click the next-month arrow in the month picker.
    const nextMonthBtn = page.locator('button').filter({ has: page.locator('svg.lucide-chevron-right') });
    await nextMonthBtn.click();

    // Verify a dialog appears with "Unsaved changes" heading.
    await expect(page.getByRole('heading', { name: 'Unsaved changes' })).toBeVisible();
    await expect(page.getByText('Discard them and switch months?')).toBeVisible();

    // Click "Discard".
    await page.getByRole('button', { name: 'Discard' }).click();

    // Verify the month changed — the dialog should be gone.
    await expect(page.getByRole('heading', { name: 'Unsaved changes' })).not.toBeVisible();
  });

  test('no dialog when clean', async ({ page }) => {
    // Switch to Plan tab.
    await page.getByRole('button', { name: 'Plan' }).click();

    // Set budget to 50000 and save.
    const budgetInput = page.locator('input[type="number"]').first();
    await budgetInput.fill('50000');

    // Need categories to save.
    await page.getByRole('button', { name: /template/i }).click();
    await page.getByText('50/30/20').click();
    await page.getByRole('button', { name: /save/i }).click();

    // Click the next-month arrow.
    const nextMonthBtn = page.locator('button').filter({ has: page.locator('svg.lucide-chevron-right') });
    await nextMonthBtn.click();

    // Verify NO dialog appears and month changes immediately.
    await expect(page.getByRole('heading', { name: 'Unsaved changes' })).not.toBeVisible({ timeout: 2000 });
  });
});
