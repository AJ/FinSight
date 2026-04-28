import { Page, expect, BrowserContext } from '@playwright/test';
import { getReviewSessionTransactions } from '../../utils/storageHelpers';

/**
 * Bypasses the onboarding wizard and clears any sticky modals.
 * Call this BEFORE page.goto() in beforeEach hooks.
 */
export async function setupTestContext(context: BrowserContext): Promise<void> {
  // 1. Bypass Onboarding Wizard
  await context.addInitScript(() => {
    window.localStorage.setItem('onboarding-storage', JSON.stringify({
      state: { hasCompletedOnboarding: true },
      version: 1
    }));
    // 2. Force LM Studio Configuration
    window.localStorage.setItem('settings-storage', JSON.stringify({
      state: {
        llmProvider: 'lmstudio',
        llmServerUrl: 'http://localhost:1234',
        llmModel: 'test-model' // Placeholder, will be overridden by mocks
      },
      version: 1
    }));
  });

  // 3. Wait for the settings store to hydrate from localStorage
  // The Zustand persist middleware reads localStorage on first store access,
  // which happens when any component imports the store. The addInitScript
  // runs before JS execution, so localStorage is set. We just need to wait
  // for the store to be created (which happens on first import).
}

/**
 * Freeze the browser clock for deterministic date-sensitive UI tests.
 * Call this before page.goto().
 */
export async function freezeBrowserDate(
  context: BrowserContext,
  isoDate: string
): Promise<void> {
  await context.addInitScript((fixedIso) => {
    const fixedTime = new Date(fixedIso).getTime();
    const RealDate = Date;

    class MockDate extends RealDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) {
          super(fixedTime);
          return;
        }
        super(...(args as ConstructorParameters<typeof Date>));
      }

      static now() {
        return fixedTime;
      }

      static parse(dateString: string) {
        return RealDate.parse(dateString);
      }

      static UTC(...args: Parameters<DateConstructor['UTC']>) {
        return RealDate.UTC(...args);
      }
    }

    Object.setPrototypeOf(MockDate, RealDate);
    MockDate.prototype = RealDate.prototype;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).Date = MockDate;
  }, isoDate);
}

/**
 * Closes any open dialogs/modals (Settings, Onboarding, etc.)
 */
export async function closeAllDialogs(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500); // Wait for animation
  await page.keyboard.press('Escape');
}

/**
 * Wait for the upload processing to complete.
 */
export async function waitForUploadCompletion(page: Page, timeout = 15000): Promise<void> {
  // Prioritize URL change as it's the most reliable signal
  await page.waitForURL('**/review', { timeout });
}

/**
 * Mocks the browser-direct LM Studio LLM calls so categorization
 * completes without a running LLM. Intercepts the OpenAI-compatible
 * endpoints that the browser client uses.
 */
export async function mockCategorizationAPI(context: BrowserContext): Promise<void> {
  // Mock the models/status check (GET /v1/models)
  await context.route('**/v1/models', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [{ id: 'test-model' }] }),
    });
  });

  // Mock the generate endpoint (POST /v1/chat/completions)
  // Returns an empty categorization array — the categorizer falls back
  // to keyword matching for all transactions.
  await context.route('**/v1/chat/completions', async (route) => {
    const request = route.request();
    const body = request.postDataJSON();

    if (body?.stream) {
      // Streaming chat request — return a minimal SSE response
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'data: {"choices":[{"delta":{"content":"[]"}}]}\n\ndata: [DONE]\n\n',
      });
      return;
    }

    // Non-streaming generate (categorization) — return empty array
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
 * Helper to upload a file via the upload dialog.
 * @param password - Optional PDF password. If provided, fills in the password dialog.
 */
export async function uploadFile(page: Page, fixturePath: string, options?: { password?: string }): Promise<void> {
  await closeAllDialogs(page);

  const uploadBtn = page.getByRole('button', { name: 'Upload Statement', exact: true });
  await expect(uploadBtn).toBeVisible({ timeout: 5000 });
  await uploadBtn.click();

  // Wait for the upload dialog to fully render — React may re-render and replace the file input
  await expect(page.getByText('Upload Your Statement')).toBeVisible({ timeout: 5000 });
  // Wait one tick for React stabilization
  await page.waitForTimeout(100);

  // Now get a fresh reference to the stable input
  const fileInput = page.locator('#file-upload');

  await fileInput.setInputFiles(fixturePath);
  await page.waitForTimeout(100);

  // Statement type dialog appears for ALL file types (PDF, CSV, XLS, XLSX)
  // For PDFs: Auto-detect is pre-selected, Continue is enabled
  // For CSV/XLSX: No default — user must pick Bank or Credit Card first
  const continueBtn = page.getByRole('button', { name: 'Continue', exact: true });
  await expect(continueBtn).toBeVisible({ timeout: 10000 });

  // For CSV/XLSX files, auto-detect is not available, so select Bank by default
  const autoDetect = page.locator('#auto-detect');
  const isAutoVisible = await autoDetect.isVisible({ timeout: 1000 }).catch(() => false);
  if (!isAutoVisible) {
    // CSV/XLSX — must pick Bank or Credit Card explicitly; default to Bank
    const bankRadio = page.locator('#bank-statement');
    await expect(bankRadio).toBeVisible({ timeout: 5000 });
    await bankRadio.click();
    // Wait for Continue button to become enabled
    await expect(continueBtn).toBeEnabled({ timeout: 3000 });
  }

  // Use Playwright's click — waits for actionability (stable, enabled, visible)
  await continueBtn.click();

  if (options?.password) {
    // For password-protected PDFs, wait for password dialog
    const passwordInput = page.locator('#pdf-password');
    await expect(passwordInput).toBeVisible({ timeout: 30000 });
    await passwordInput.fill(options.password);

    const unlockBtn = page.getByRole('button', { name: 'Unlock & Parse', exact: true });
    await expect(unlockBtn).toBeVisible({ timeout: 3000 });
    await unlockBtn.click();
    // Wait for processing to start
    await page.waitForTimeout(2000);
  }
}

/**
 * Verify the UI matches localStorage data.
 */
export async function verifyUIMatchesStorage(page: Page): Promise<string[]> {
  const errors: string[] = [];
  const storedTxns = await getReviewSessionTransactions(page);
  const uiRows = await page.locator('tr[data-transaction-id], .transaction-row, tbody tr').count();

  if (uiRows !== storedTxns.length) {
    errors.push(`UI transaction count (${uiRows}) does not match storage (${storedTxns.length})`);
  }
  return errors;
}
