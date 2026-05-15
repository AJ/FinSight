import { test, expect } from '@playwright/test';
import { clearAllStorage } from '@tests/utils/storageHelpers';

/**
 * E2E tests for the 3-step onboarding wizard.
 *
 * This suite does NOT use `setupTestContext` — it needs fresh browser state
 * to trigger the onboarding overlay. Each test starts with empty storage.
 *
 * Wizard flow:
 *   Step 1: Select provider (Ollama / LM Studio) → connect to server
 *   Step 2: Select model from discovered models
 *   Step 3: Select currency → "Get Started" completes onboarding
 */

test.describe('Onboarding wizard', () => {
  test.beforeEach(async ({ context }) => {
    await clearAllStorage(context);
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Mock LM Studio endpoints (OpenAI-compatible). These are simpler to mock
   * because they use standard `/v1/models` paths.
   */
  async function mockLmStudioEndpoints(
    context: import('@playwright/test').BrowserContext,
    options?: { modelsStatus?: number },
  ) {
    const modelsStatus = options?.modelsStatus ?? 200;

    await context.route('**/v1/models', async (route) => {
      if (modelsStatus !== 200) {
        await route.fulfill({
          status: modelsStatus,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Server error' }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [{ id: 'test-model-1' }, { id: 'test-model-2' }],
        }),
      });
    });

    // Mock chat completions for any background calls
    await context.route('**/v1/chat/completions', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          choices: [{ message: { content: '[]' } }],
        }),
      });
    });
  }

  /**
   * Completes Step 1: selects LM Studio provider and connects.
   */
  async function completeStep1(page: import('@playwright/test').Page) {
    // Step 1: Select LM Studio provider
    await expect(page.getByRole('heading', { name: 'Welcome to FinSight' })).toBeVisible({ timeout: 10000 });

    // Click the LM Studio card
    await page.getByText('LM Studio').first().click();

    // The URL input should be populated with the default LM Studio URL
    const urlInput = page.locator('#serverUrl');
    await expect(urlInput).toBeVisible();
    await expect(urlInput).toHaveValue('http://localhost:1234');

    // Click Connect
    const connectBtn = page.getByRole('button', { name: 'Connect' });
    await expect(connectBtn).toBeVisible();
    await connectBtn.click();

    // Wait for connection success indicator
    await expect(page.getByText(/connected.*found.*model/i)).toBeVisible({ timeout: 10000 });

    // Click Continue to advance to Step 2
    await page.getByRole('button', { name: 'Continue' }).click();
  }

  /**
   * Completes Step 2: selects the first model from the dropdown.
   */
  async function completeStep2(page: import('@playwright/test').Page) {
    await expect(page.getByRole('heading', { name: 'Connect to AI Provider' })).toBeVisible({ timeout: 5000 });

    // react-select uses a text input that we type into to filter, then select
    const modelInput = page.locator('#model');
    await expect(modelInput).toBeVisible();
    await modelInput.click();

    // Select the first model option
    await page.getByText('test-model-1').first().click();

    // Click Continue
    await page.getByRole('button', { name: 'Continue' }).click();
  }

  /**
   * Completes Step 3: selects USD as currency and finishes onboarding.
   */
  async function completeStep3(page: import('@playwright/test').Page) {
    await expect(page.getByRole('heading', { name: 'Select Your Currency' })).toBeVisible({ timeout: 5000 });

    // Type into the react-select currency input
    const currencyInput = page.locator('#currency');
    await expect(currencyInput).toBeVisible();
    await currencyInput.click();
    await currencyInput.fill('USD');

    // Select USD from the dropdown
    await page.getByText('USD - US Dollar').click();

    // Click "Get Started" to complete
    await page.getByRole('button', { name: 'Get Started' }).click();
  }

  // ---------------------------------------------------------------------------
  // Tests
  // ---------------------------------------------------------------------------

  test('completes 3-step onboarding and verifies settings are saved', async ({ page, context }) => {
    await mockLmStudioEndpoints(context);

    await page.goto('/');

    await completeStep1(page);
    await completeStep2(page);
    await completeStep3(page);

    // Onboarding dialog should be gone — check that the dialog description (unique to the modal) disappears
    await expect(page.getByText("Let's set up your AI provider to get started")).not.toBeVisible({ timeout: 5000 });

    // Verify settings were persisted to localStorage
    const settings = await page.evaluate(() => {
      const raw = localStorage.getItem('settings-storage');
      return raw ? JSON.parse(raw) : null;
    });

    expect(settings).not.toBeNull();
    expect(settings.state.llmProvider).toBe('lmstudio');
    expect(settings.state.llmModel).toBe('test-model-1');
    expect(settings.state.currency.code).toBe('USD');

    // Verify onboarding is marked complete
    const onboarding = await page.evaluate(() => {
      const raw = localStorage.getItem('onboarding-storage');
      return raw ? JSON.parse(raw) : null;
    });
    expect(onboarding.state.hasCompletedOnboarding).toBe(true);
  });

  test('connection failure shows error message', async ({ page, context }) => {
    // Mock a server error on the models endpoint
    await mockLmStudioEndpoints(context, { modelsStatus: 500 });

    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Welcome to FinSight' })).toBeVisible({ timeout: 10000 });

    // Select LM Studio
    await page.getByText('LM Studio').first().click();

    // Click Connect
    const connectBtn = page.getByRole('button', { name: 'Connect' });
    await connectBtn.click();

    // Should see an error message about connection failure
    await expect(page.getByText(/cannot reach|connection failed|error/i)).toBeVisible({ timeout: 10000 });

    // Continue button should remain disabled (not connected)
    const continueBtn = page.getByRole('button', { name: 'Continue' });
    await expect(continueBtn).toBeDisabled();
  });

  test('model list populates after successful connection', async ({ page, context }) => {
    await mockLmStudioEndpoints(context);

    await page.goto('/');

    await completeStep1(page);

    // Now on Step 2 — verify the model dropdown has options
    await expect(page.getByRole('heading', { name: 'Connect to AI Provider' })).toBeVisible({ timeout: 5000 });

    const modelInput = page.locator('#model');
    await modelInput.click();

    // Both test models should appear in the dropdown
    await expect(page.getByText('test-model-1')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('test-model-2')).toBeVisible({ timeout: 5000 });
  });

  test('currency selection persists in localStorage', async ({ page, context }) => {
    await mockLmStudioEndpoints(context);

    await page.goto('/');

    await completeStep1(page);
    await completeStep2(page);

    // Step 3: select EUR this time
    await expect(page.getByRole('heading', { name: 'Select Your Currency' })).toBeVisible({ timeout: 5000 });

    const currencyInput = page.locator('#currency');
    await currencyInput.click();
    await currencyInput.fill('EUR');

    await page.getByText('EUR - Euro').click();

    await page.getByRole('button', { name: 'Get Started' }).click();

    // Verify EUR is persisted
    await page.waitForTimeout(500);

    const settings = await page.evaluate(() => {
      const raw = localStorage.getItem('settings-storage');
      return raw ? JSON.parse(raw) : null;
    });

    expect(settings.state.currency.code).toBe('EUR');
    expect(settings.state.currency.symbol).toBe('€');
    expect(settings.state.currency.name).toBe('Euro');
  });

  test('onboarding blocks access to other pages until complete', async ({ page, context }) => {
    await mockLmStudioEndpoints(context);

    await page.goto('/');

    // Onboarding dialog should be showing
    await expect(page.getByRole('heading', { name: 'Welcome to FinSight' })).toBeVisible({ timeout: 10000 });

    // Try navigating to /transactions
    await page.goto('/transactions');

    // The onboarding dialog should still be visible — it's a modal overlay
    // that prevents interaction with the rest of the page
    await expect(page.getByRole('heading', { name: 'Welcome to FinSight' })).toBeVisible({ timeout: 10000 });

    // The dialog prevents closing (no close button, no Escape)
    // Verify the dialog is still open by checking the step indicator is visible
    await expect(page.getByText("Let's set up your AI provider to get started")).toBeVisible({ timeout: 5000 });
  });
});
