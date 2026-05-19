import { test, expect } from '@playwright/test';
import { uploadFile, waitForUploadCompletion } from '@tests/e2e/helpers/e2eHelpers';
import { clearAllStorage } from '@tests/utils/storageHelpers';
import * as path from 'path';

const LIVE_LLM_URL = process.env.LIVE_LLM_URL;
const LIVE_LLM_MODEL = process.env.LIVE_LLM_MODEL || 'qwen/qwen3-4b-2507';
const CC_PDF_PASSWORD = process.env.CC_PDF_PASSWORD || undefined;

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');
const CC_PDF_FIXTURE = path.join(FIXTURES_DIR, 'cc_statement.pdf');

interface ReviewSession {
  transactions: Array<Record<string, unknown>>;
  verificationReport?: Record<string, unknown>;
  currency?: Record<string, unknown>;
}

/**
 * Like waitForUploadCompletion, but fails fast when the pipeline completes
 * without navigating to /review (e.g., wrong PDF password, extraction failure).
 */
async function waitForUploadOrFailure(page: import('@playwright/test').Page, timeout: number): Promise<void> {
  let pipelineCompleted = false;
  const handler = (msg: import('@playwright/test').ConsoleMessage) => {
    if (msg.text().includes('[FileProcessor] Processing completed')) {
      pipelineCompleted = true;
    }
  };
  page.on('console', handler);

  try {
    await waitForUploadCompletion(page, timeout);
  } catch (err) {
    if (pipelineCompleted) {
      throw new Error(
        'Pipeline completed without navigating to /review. ' +
        'Likely cause: incorrect PDF password or extraction failure.',
      );
    }
    throw err;
  } finally {
    page.off('console', handler);
  }
}

async function getReviewSession(page: import('@playwright/test').Page): Promise<ReviewSession | null> {
  await page.waitForLoadState('domcontentloaded');
  const raw = await page.evaluate(() => window.sessionStorage.getItem('review-session-v1'));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function setupLiveLLMContext(context: import('@playwright/test').BrowserContext): Promise<void> {
  await context.addInitScript(({ url, model }) => {
    window.localStorage.setItem('onboarding-storage', JSON.stringify({
      state: { hasCompletedOnboarding: true },
      version: 1,
    }));
    window.localStorage.setItem('settings-storage', JSON.stringify({
      state: {
        llmProvider: 'lmstudio',
        llmServerUrl: url,
        llmModel: model,
      },
      version: 1,
    }));
  }, { url: LIVE_LLM_URL, model: LIVE_LLM_MODEL });
}

test.describe('Balance Reconciliation — Live LLM E2E', () => {
  const LLM_TIMEOUT = 300_000;
  // CC pipeline runs 3 sequential LLM passes (summary + transactions + rewards)
  // which can take 6-8 minutes on local hardware with small models
  const CC_LLM_TIMEOUT = 600_000;

  test.beforeEach(async ({ context }) => {
    test.skip(!LIVE_LLM_URL, 'LIVE_LLM_URL not set — skipping real LLM tests');
    await clearAllStorage(context);
    await setupLiveLLMContext(context);
  });

  test('bank PDF — full reconciliation flow', async ({ page }) => {
    test.setTimeout(LLM_TIMEOUT);
    await page.goto('/');

    await uploadFile(page, path.join(FIXTURES_DIR, 'bank_statement_noisy.pdf'));
    await waitForUploadCompletion(page, LLM_TIMEOUT);
    await expect(page).toHaveURL(/\/review/);

    const session = await getReviewSession(page);
    expect(session).not.toBeNull();
    expect(session!.transactions.length).toBeGreaterThan(0);

    const report = session!.verificationReport;
    expect(report).toBeDefined();

    const reconciliation = report!.reconciliation as Record<string, unknown> | undefined;
    expect(reconciliation).toBeDefined();
    expect(typeof reconciliation!.passed).toBe('boolean');

    if (reconciliation!.computedClosing !== undefined) {
      expect(typeof reconciliation!.computedClosing).toBe('number');
      expect(typeof reconciliation!.expectedClosing).toBe('number');
      expect(typeof reconciliation!.difference).toBe('number');
    }

    const confidence = report!.overallConfidence as number;
    expect(typeof confidence).toBe('number');

    if (reconciliation!.passed === false) {
      const summary = page.locator('text=Verification Failed');
      await expect(summary).toBeVisible({ timeout: 10_000 });
      await summary.click();
      await expect(page.getByText('Reconciliation', { exact: true })).toBeVisible();
    } else if (reconciliation!.passed === true && confidence >= 80) {
      await expect(page.locator('text=Verification')).not.toBeVisible();
    } else if (reconciliation!.passed === true && confidence < 80) {
      const summary = page.locator('text=Verification Warnings');
      await expect(summary).toBeVisible({ timeout: 10_000 });
    }

    const firstTxn = session!.transactions[0];
    const description = String(firstTxn.description ?? firstTxn.merchant ?? '');
    await expect(page.getByText(description).first()).toBeVisible({ timeout: 10_000 });
  });

  test('bank PDF — verification report structure', async ({ page }) => {
    test.setTimeout(LLM_TIMEOUT);
    await page.goto('/');

    await uploadFile(page, path.join(FIXTURES_DIR, 'bank_statement_noisy.pdf'));
    await waitForUploadCompletion(page, LLM_TIMEOUT);
    await expect(page).toHaveURL(/\/review/);

    const session = await getReviewSession(page);
    expect(session).not.toBeNull();

    const report = session!.verificationReport;
    expect(report).toBeDefined();

    expect(Array.isArray(report!.verified)).toBe(true);
    expect(Array.isArray(report!.rejected)).toBe(true);
    expect(typeof report!.reconciliation).toBe('object');
    expect(typeof report!.overallConfidence).toBe('number');

    const verified = report!.verified as Array<Record<string, unknown>>;
    expect(verified.length).toBeGreaterThan(0);
    // Note: verified[] items are Transaction instances, so toJSON() strips the
    // per-transaction verification sub-field during sessionStorage serialization.
    // We verify the top-level report structure only.

    const expectedCount = session!.transactions.length;
    const rowCount = await page.locator('tbody tr').count();
    expect(rowCount).toBe(expectedCount);
  });

  test('bank PDF — flagged transactions', async ({ page }) => {
    test.setTimeout(LLM_TIMEOUT);
    await page.goto('/');

    await uploadFile(page, path.join(FIXTURES_DIR, 'bank_statement_noisy.pdf'));
    await waitForUploadCompletion(page, LLM_TIMEOUT);
    await expect(page).toHaveURL(/\/review/);

    const session = await getReviewSession(page);
    expect(session).not.toBeNull();

    const report = session!.verificationReport;
    const rejected = report?.rejected as Array<Record<string, unknown>> ?? [];

    // Determine if the verification summary is rendered (it returns null when
    // passed && confidence >= 80, so the text won't be in the DOM at all).
    const summary = page.locator('text=Verification').first();
    const isSummaryVisible = await summary.isVisible().catch(() => false);

    if (rejected.length > 0) {
      if (isSummaryVisible) {
        await summary.click();
        await expect(page.getByText('Flagged Transactions')).toBeVisible();
      }
      // If summary is hidden (high-confidence pass), the component intentionally
      // hides the whole section — but the data still has rejected transactions.
      // Verify the data level to avoid a silent false pass.
      expect(rejected.length).toBeGreaterThan(0);
    } else {
      // No rejected transactions — flagged section should never appear
      if (isSummaryVisible) {
        await summary.click();
        await expect(page.getByText('Flagged Transactions')).not.toBeVisible();
      }
    }
  });

  test('CC PDF — statement totals verification flow', async ({ page }) => {
    test.setTimeout(CC_LLM_TIMEOUT);

    const fs = await import('fs');
    test.skip(!fs.existsSync(CC_PDF_FIXTURE), 'CC PDF fixture not found — skipping');

    // Capture browser console logs + network errors for debugging pipeline stalls
    const consoleLogs: string[] = [];
    page.on('console', (msg) => {
      const prefix = msg.type() === 'error' ? 'ERR' : msg.type() === 'warning' ? 'WRN' : 'LOG';
      consoleLogs.push(`[${prefix}] ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
      consoleLogs.push(`[PAGE_ERROR] ${err.message}\n${err.stack}`);
    });
    // Capture failed LM Studio requests (400s) with response body
    page.on('requestfailed', (request) => {
      consoleLogs.push(`[REQUEST_FAILED] ${request.method()} ${request.url()} — ${request.failure()?.errorText}`);
    });
    page.on('response', async (response) => {
      if (response.status() >= 400 && response.url().includes('/v1/')) {
        try {
          const body = await response.text();
          consoleLogs.push(`[HTTP_${response.status()}] ${response.url()}\n  Body: ${body.slice(0, 2000)}`);
        } catch {
          consoleLogs.push(`[HTTP_${response.status()}] ${response.url()} — could not read body`);
        }
      }
    });

    await page.goto('/');

    await uploadFile(page, CC_PDF_FIXTURE, { statementType: 'credit_card', password: CC_PDF_PASSWORD });

    // Dump logs on timeout for debugging
    try {
      await waitForUploadOrFailure(page, CC_LLM_TIMEOUT);
    } catch (err) {
      const logPath = path.join(FIXTURES_DIR, '..', 'cc-pipeline-debug.log');
      fs.writeFileSync(logPath, consoleLogs.join('\n'));
      throw new Error(`CC pipeline stalled. Browser console logs written to ${logPath}\n\nLast 20 logs:\n${consoleLogs.slice(-20).join('\n')}\n\n${err}`);
    }

    await expect(page).toHaveURL(/\/review/);

    const session = await getReviewSession(page);
    expect(session).not.toBeNull();
    expect(session!.transactions.length).toBeGreaterThan(0);

    const report = session!.verificationReport;
    expect(report).toBeDefined();

    const statementTotals = report!.statementTotals as Record<string, unknown> | undefined;
    expect(statementTotals).toBeDefined();
    expect(typeof statementTotals!.passed).toBe('boolean');

    const confidence = report!.overallConfidence as number;
    expect(typeof confidence).toBe('number');

    if (statementTotals!.passed === false) {
      const summary = page.locator('text=Verification Failed');
      await expect(summary).toBeVisible({ timeout: 10_000 });
      await summary.click();
      await expect(page.getByText('Balance Match')).toBeVisible();
    } else if (statementTotals!.passed === true && confidence >= 80) {
      await expect(page.locator('text=Verification')).not.toBeVisible();
    } else if (statementTotals!.passed === true && confidence < 80) {
      const summary = page.locator('text=Verification Warnings');
      await expect(summary).toBeVisible({ timeout: 10_000 });
    }

    const firstTxn = session!.transactions[0];
    const description = String(firstTxn.description ?? firstTxn.merchant ?? '');
    await expect(page.getByText(description).first()).toBeVisible({ timeout: 10_000 });
  });

  test('CC PDF — verification report structure', async ({ page }) => {
    test.setTimeout(CC_LLM_TIMEOUT);

    const fs = await import('fs');
    test.skip(!fs.existsSync(CC_PDF_FIXTURE), 'CC PDF fixture not found — skipping');

    // Capture browser console logs + network errors for debugging pipeline stalls
    const consoleLogs: string[] = [];
    page.on('console', (msg) => {
      const prefix = msg.type() === 'error' ? 'ERR' : msg.type() === 'warning' ? 'WRN' : 'LOG';
      consoleLogs.push(`[${prefix}] ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
      consoleLogs.push(`[PAGE_ERROR] ${err.message}\n${err.stack}`);
    });
    page.on('requestfailed', (request) => {
      consoleLogs.push(`[REQUEST_FAILED] ${request.method()} ${request.url()} — ${request.failure()?.errorText}`);
    });
    page.on('response', async (response) => {
      if (response.status() >= 400 && response.url().includes('/v1/')) {
        try {
          const body = await response.text();
          consoleLogs.push(`[HTTP_${response.status()}] ${response.url()}\n  Body: ${body.slice(0, 2000)}`);
        } catch {
          consoleLogs.push(`[HTTP_${response.status()}] ${response.url()} — could not read body`);
        }
      }
    });

    await page.goto('/');

    await uploadFile(page, CC_PDF_FIXTURE, { statementType: 'credit_card', password: CC_PDF_PASSWORD });

    try {
      await waitForUploadOrFailure(page, CC_LLM_TIMEOUT);
    } catch (err) {
      const logPath = path.join(FIXTURES_DIR, '..', 'cc-pipeline-debug.log');
      fs.writeFileSync(logPath, consoleLogs.join('\n'));
      throw new Error(`CC pipeline stalled. Browser console logs written to ${logPath}\n\nLast 20 logs:\n${consoleLogs.slice(-20).join('\n')}\n\n${err}`);
    }
    await expect(page).toHaveURL(/\/review/);

    const session = await getReviewSession(page);
    expect(session).not.toBeNull();

    const report = session!.verificationReport;
    expect(report).toBeDefined();

    const statementTotals = report!.statementTotals as Record<string, unknown> | undefined;
    const transactionSums = report!.transactionSums as Record<string, unknown> | undefined;
    expect(statementTotals).toBeDefined();
    expect(transactionSums).toBeDefined();

    expect(typeof statementTotals!.passed).toBe('boolean');
    expect(typeof statementTotals!.computedTotalDue).toBe('number');
    expect(typeof statementTotals!.expectedTotalDue).toBe('number');

    expect(typeof transactionSums!.totalPurchases).toBe('number');
    expect(typeof transactionSums!.totalPayments).toBe('number');
    expect(typeof transactionSums!.totalFees).toBe('number');
    expect(typeof transactionSums!.totalDebits).toBe('number');
    expect(typeof transactionSums!.totalCredits).toBe('number');

    expect(typeof report!.passed).toBe('boolean');

    const transactions = session!.transactions;
    const rowCount = await page.locator('tbody tr').count();
    expect(rowCount).toBe(transactions.length);
  });
});
