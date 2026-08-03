import { test, expect } from '@playwright/test';
import {
  skipIfNoLiveLLM,
  seedLiveLLMSettings,
  waitForUploadOrFailure,
  getReviewSession,
  setupConsoleCapture,
  dumpLogsOnFailure,
  elapsedSince,
  FIXTURES_DIR,
} from '@tests/e2e/helpers/liveTestHelpers';
import { uploadFile } from '@tests/e2e/helpers/e2eHelpers';
import { clearAllStorage } from '@tests/utils/storageHelpers';
import * as path from 'path';
import * as fs from 'fs';
import { LLM_TEST_TIMEOUT, BANK_PIPELINE_TIMEOUT } from '@tests/e2e/helpers/liveTimeouts';

const CC_FIXTURE = path.join(FIXTURES_DIR, 'cc_statement.pdf');
const CC_PDF_PASSWORD = process.env.CC_PDF_PASSWORD || undefined;

test.describe('PDF Password — Live LLM', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ context }) => {
    skipIfNoLiveLLM();
    await clearAllStorage(context);
    await seedLiveLLMSettings(context);
  });

  test('encrypted CC PDF — correct password extracts successfully', async ({ page }) => {
    test.setTimeout(LLM_TEST_TIMEOUT);
    test.skip(!fs.existsSync(CC_FIXTURE), 'CC PDF fixture not found — skipping');

    const consoleLogs = setupConsoleCapture(page);
    const t0 = Date.now();

    await page.goto('/');
    await uploadFile(page, CC_FIXTURE, {
      statementType: 'credit_card',
      password: CC_PDF_PASSWORD,
    });
    console.log(`[pdf-pw] upload: ${elapsedSince(t0)}`);

    try {
      await waitForUploadOrFailure(page, BANK_PIPELINE_TIMEOUT);
    } catch (err) {
      dumpLogsOnFailure(consoleLogs, err, 'pdf-pw');
    }
    console.log(`[pdf-pw] pipeline done: ${elapsedSince(t0)}`);

    await expect(page).toHaveURL(/\/review/);

    const session = await getReviewSession(page);
    expect(session).not.toBeNull();
    expect(session!.transactions.length).toBeGreaterThan(0);

    // Validate amounts are positive numbers
    for (const txn of session!.transactions) {
      expect(typeof txn.amount).toBe('number');
    }

    // Validate dates are parseable
    for (const txn of session!.transactions) {
      const d = new Date(String(txn.date));
      expect(isNaN(d.getTime())).toBe(false);
    }

    console.log(`[pdf-pw] total: ${elapsedSince(t0)}`);
  });

  test('wrong password shows error, correct password succeeds on retry', async ({ page }) => {
    test.setTimeout(LLM_TEST_TIMEOUT);
    test.skip(!fs.existsSync(CC_FIXTURE), 'CC PDF fixture not found — skipping');
    test.skip(!CC_PDF_PASSWORD, 'CC_PDF_PASSWORD not set — skipping');

    const t0 = Date.now();

    await page.goto('/');

    // Upload with wrong password
    await uploadFile(page, CC_FIXTURE, {
      statementType: 'credit_card',
      password: 'wrong-password-123',
    });

    // Should show password error
    await expect(page.getByText(/incorrect password.*attempts remaining/i)).toBeVisible({
      timeout: 15_000,
    });
    console.log(`[pdf-pw-wrong] error shown: ${elapsedSince(t0)}`);

    // Retry with correct password
    const pwInput = page.locator('#pdf-password');
    await pwInput.clear();
    await pwInput.fill(CC_PDF_PASSWORD!);
    await page.getByRole('button', { name: /unlock.*parse/i }).click();

    // Should eventually reach review page
    await waitForUploadOrFailure(page, BANK_PIPELINE_TIMEOUT);
    await expect(page).toHaveURL(/\/review/);

    const session = await getReviewSession(page);
    expect(session).not.toBeNull();
    expect(session!.transactions.length).toBeGreaterThan(0);

    console.log(`[pdf-pw-wrong] total: ${elapsedSince(t0)}`);
  });
});
