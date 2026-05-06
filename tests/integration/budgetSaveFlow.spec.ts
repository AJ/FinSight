import { test, expect } from '@playwright/test';
import { clearAllStorage, getLocalStorage } from '@tests/utils/storageHelpers';
import { setupTestContext } from '@tests/e2e/helpers/e2eHelpers';

test.describe('Budget Save/Edit Flow', () => {
  test.beforeEach(async ({ context }) => {
    await clearAllStorage(context);
    await setupTestContext(context);
  });

  test('save a new budget from scratch', async ({ page }) => {
    await page.goto('/budget?tab=plan&month=2026-04');

    // Wait for the plan tab to render
    await expect(page.getByText('Total Budget')).toBeVisible({ timeout: 10000 });

    // Find the total budget income input and fill it
    const incomeInput = page.locator('input[type="number"]').first();
    await incomeInput.fill('50000');

    // The Save button should be disabled until categories exist.
    // We need to add at least one category row via Template or Add.
    // Use the Template dropdown to populate categories.
    const templateButton = page.getByRole('button', { name: /template/i });
    await templateButton.click();

    // Select the 50/30/20 template option
    const templateOption = page.getByText('50/30/20 (Needs/Wants/Saves)');
    await templateOption.click();

    // Verify category rows appeared
    await expect(page.getByText('Groceries')).toBeVisible({ timeout: 5000 });

    // Click Save
    const saveButton = page.getByRole('button', { name: /save/i });
    await expect(saveButton).toBeEnabled({ timeout: 5000 });
    await saveButton.click();

    // Verify localStorage updated with the period
    const stored = await getLocalStorage(page, 'budget-storage') as {
      state: { periods: Record<string, unknown> };
    } | null;
    expect(stored).not.toBeNull();
    expect(stored!.state.periods).toHaveProperty('2026-04');
  });

  test('edit existing budget', async ({ page, context }) => {
    // Seed budget-storage via addInitScript so it survives the clearAllStorage wipe
    await context.addInitScript(() => {
      window.localStorage.setItem('budget-storage', JSON.stringify({
        state: {
          periods: {
            '2026-04': {
              month: '2026-04',
              income: 50000,
              allocations: [{ categoryId: 'groceries', amount: 10000 }],
              hiddenCategories: [],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          },
          notifications: { dismissedNoBudget: null, dismissedEOM: null },
        },
        version: 0,
      }));
    });

    await page.goto('/budget?tab=plan&month=2026-04');
    await expect(page.getByText('Total Budget')).toBeVisible({ timeout: 10000 });

    // Verify the income input shows 50000
    const incomeInput = page.locator('input[type="number"]').first();
    await expect(incomeInput).toHaveValue('50000');

    // Verify groceries row is visible with its amount
    await expect(page.getByText('Groceries')).toBeVisible();

    // Change income to 60000
    await incomeInput.fill('60000');

    // Click Save
    const saveButton = page.getByRole('button', { name: /save/i });
    await expect(saveButton).toBeEnabled({ timeout: 5000 });
    await saveButton.click();

    // Verify localStorage updated
    const stored = await getLocalStorage(page, 'budget-storage') as {
      state: { periods: Record<string, { income: number }> };
    } | null;
    expect(stored).not.toBeNull();
    expect(stored!.state.periods['2026-04'].income).toBe(60000);
  });

  test('template application', async ({ page }) => {
    await page.goto('/budget?tab=plan&month=2026-04');
    await expect(page.getByText('Total Budget')).toBeVisible({ timeout: 10000 });

    // Set income first (template requires income or median)
    const incomeInput = page.locator('input[type="number"]').first();
    await incomeInput.fill('50000');

    // Open the Template dropdown
    const templateButton = page.getByRole('button', { name: /template/i });
    await templateButton.click();

    // Select 50/30/20
    const templateOption = page.getByText('50/30/20 (Needs/Wants/Saves)');
    await templateOption.click();

    // Verify category rows appeared with amounts (Groceries is a default Needs category)
    await expect(page.getByText('Groceries')).toBeVisible({ timeout: 5000 });

    // The category inputs should have non-zero values
    // Find a category row input (not the Total Budget one) and verify it has a value
    const categoryInputs = page.locator('.bg-card.border.border-border.rounded-lg.overflow-hidden input[type="number"]');
    const inputCount = await categoryInputs.count();
    expect(inputCount).toBeGreaterThan(0);

    // Verify at least one category input has a non-zero value
    let hasNonZeroValue = false;
    for (let i = 0; i < inputCount; i++) {
      const val = await categoryInputs.nth(i).inputValue();
      if (val && parseInt(val, 10) > 0) {
        hasNonZeroValue = true;
        break;
      }
    }
    expect(hasNonZeroValue).toBe(true);

    // Click Save
    const saveButton = page.getByRole('button', { name: /save/i });
    await expect(saveButton).toBeEnabled({ timeout: 5000 });
    await saveButton.click();

    // Verify localStorage
    const stored = await getLocalStorage(page, 'budget-storage') as {
      state: { periods: Record<string, { income: number; allocations: { categoryId: string; amount: number }[] }> };
    } | null;
    expect(stored).not.toBeNull();
    expect(stored!.state.periods['2026-04'].income).toBe(50000);
    expect(stored!.state.periods['2026-04'].allocations.length).toBeGreaterThan(0);
  });

  test('carry-forward between months', async ({ page, context }) => {
    // Seed budget for 2026-04 via addInitScript so it survives navigation
    await context.addInitScript(() => {
      window.localStorage.setItem('budget-storage', JSON.stringify({
        state: {
          periods: {
            '2026-04': {
              month: '2026-04',
              income: 50000,
              allocations: [{ categoryId: 'groceries', amount: 15000 }],
              hiddenCategories: [],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          },
          notifications: { dismissedNoBudget: null, dismissedEOM: null },
        },
        version: 0,
      }));
    });

    // Navigate to May 2026 plan tab — carry-forward loads April's state
    await page.goto('/budget?tab=plan&month=2026-05');
    await expect(page.getByText('Total Budget')).toBeVisible({ timeout: 10000 });

    // The carry-forward logic loads April's income into the working state for May
    // Verify the income input shows the carried-forward value of 50000
    const incomeInput = page.locator('input[type="number"]').first();
    await expect(incomeInput).toHaveValue('50000');

    // Verify groceries is carried forward with its amount
    await expect(page.getByText('Groceries')).toBeVisible();
  });

  test('auto-fill populates allocations from transaction history', async ({ page, context }) => {
    // Build transaction data for the past 3 months
    const now = new Date();
    const months = [
      new Date(now.getFullYear(), now.getMonth() - 2, 15),
      new Date(now.getFullYear(), now.getMonth() - 1, 15),
      new Date(now.getFullYear(), now.getMonth(), 15),
    ];
    const transactions = months.flatMap((m, mi) => [
      {
        id: `groceries-${mi}`,
        date: m.toISOString(),
        description: `Groceries ${mi}`,
        amount: 8000 + mi * 100,
        type: 'debit',
        category: 'groceries',
        localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
        isInternational: false,
      },
      {
        id: `dining-${mi}`,
        date: m.toISOString(),
        description: `Dining ${mi}`,
        amount: 3000 + mi * 50,
        type: 'debit',
        category: 'dining',
        localCurrency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
        isInternational: false,
      },
    ]);

    const txStorage = JSON.stringify({
      state: { transactions, selectedIds: [], isCategorizing: false, categorizeProgress: '' },
      version: 0,
    });

    // Seed via addInitScript so data survives clearAllStorage's wipe
    await context.addInitScript((txData: string) => {
      window.localStorage.setItem('transaction-storage', txData);
    }, txStorage);

    await page.goto('/budget?tab=plan&month=2026-04');
    await expect(page.getByText('Total Budget')).toBeVisible({ timeout: 10000 });

    // Set income
    const incomeInput = page.locator('input[type="number"]').first();
    await incomeInput.fill('50000');

    // Click Auto-fill
    const autoFillBtn = page.getByRole('button', { name: /auto-fill/i });
    await autoFillBtn.click();

    // Verify category rows appeared with allocations
    await expect(page.getByText('Groceries')).toBeVisible({ timeout: 5000 });

    // Verify the allocated summary shows something
    await expect(page.getByText(/Allocated:/)).toBeVisible();

    // Save and verify localStorage
    const saveButton = page.getByRole('button', { name: /save/i });
    await expect(saveButton).toBeEnabled({ timeout: 5000 });
    await saveButton.click();

    const stored = await getLocalStorage(page, 'budget-storage') as {
      state: { periods: Record<string, { allocations: { categoryId: string }[] }> };
    } | null;
    expect(stored).not.toBeNull();
    const period = stored!.state.periods['2026-04'];
    expect(period).toBeDefined();
    expect(period.allocations.length).toBeGreaterThan(0);
  });
});
