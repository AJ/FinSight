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

// ── Timing helpers ──────────────────────────────────────────────────────────────

function elapsedSince(start: number): string {
  return `${((Date.now() - start) / 1000).toFixed(1)}s`;
}

// ── Test helpers ────────────────────────────────────────────────────────────────

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

function setupConsoleCapture(page: import('@playwright/test').Page): string[] {
  const consoleLogs: string[] = [];
  page.on('console', (msg) => {
    const prefix = msg.type() === 'error' ? 'ERR' : msg.type() === 'warning' ? 'WRN' : 'LOG';
    consoleLogs.push(`[${prefix}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    consoleLogs.push(`[PAGE_ERROR] ${err.message}\n${err.stack}`);
  });
  page.on('requestfailed', (request) => {
    consoleLogs.push(`[REQUEST_FAILED] ${request.method()} ${request.url()} -- ${request.failure()?.errorText}`);
  });
  page.on('response', async (response) => {
    if (response.status() >= 400 && response.url().includes('/v1/')) {
      try {
        const body = await response.text();
        consoleLogs.push(`[HTTP_${response.status()}] ${response.url()}\n  Body: ${body.slice(0, 2000)}`);
      } catch {
        consoleLogs.push(`[HTTP_${response.status()}] ${response.url()} -- could not read body`);
      }
    }
  });
  return consoleLogs;
}

function dumpLogsOnFailure(consoleLogs: string[], err: unknown): never {
  const fsSync = require('fs');
  const logPath = path.join(FIXTURES_DIR, '..', 'cc-pipeline-debug.log');
  fsSync.writeFileSync(logPath, consoleLogs.join('\n'));
  throw new Error(`CC pipeline stalled. Logs written to ${logPath}\n\nLast 20 logs:\n${consoleLogs.slice(-20).join('\n')}\n\n${err}`);
}

// ── Tests ────────────────────────────────────────────────────────────────────────

test.describe('Balance Reconciliation -- Live LLM E2E', () => {
  // Run serially to avoid exhausting LM Studio's KV cache.
  // With 3 workers running bank + CC tests in parallel, GPU VRAM fills up
  // (8192 MiB limit) and CC tests get "Context size exceeded" errors.
  // Serial execution ensures previous test slots are released before the next test starts.
  test.describe.configure({ mode: 'serial' });

  // Playwright test timeout (hard ceiling for the entire test)
  const LLM_TIMEOUT = 300_000;
  const CC_LLM_TIMEOUT = 600_000;

  // waitForURL timeout — how long we wait for pipeline to complete.
  // Separate from test timeout so the test fails fast on pipeline errors.
  const BANK_PIPELINE_TIMEOUT = 240_000;
  const CC_PIPELINE_TIMEOUT = 540_000;

  test.beforeEach(async ({ context }) => {
    test.skip(!LIVE_LLM_URL, 'LIVE_LLM_URL not set -- skipping real LLM tests');
    await clearAllStorage(context);
    await setupLiveLLMContext(context);
  });

  // ── Bank tests ───────────────────────────────────────────────────────────────

  test('bank PDF -- full reconciliation flow', async ({ page }) => {
    test.setTimeout(LLM_TIMEOUT);
    const t0 = Date.now();

    await page.goto('/');
    console.log(`[bank-1] goto: ${elapsedSince(t0)}`);

    await uploadFile(page, path.join(FIXTURES_DIR, 'bank_statement_noisy.pdf'));
    console.log(`[bank-1] upload: ${elapsedSince(t0)}`);

    await waitForUploadCompletion(page, BANK_PIPELINE_TIMEOUT);
    console.log(`[bank-1] pipeline done: ${elapsedSince(t0)}`);

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
    console.log(`[bank-1] total: ${elapsedSince(t0)}`);
  });

  test('bank PDF -- verification report structure', async ({ page }) => {
    test.setTimeout(LLM_TIMEOUT);
    const t0 = Date.now();

    await page.goto('/');
    console.log(`[bank-2] goto: ${elapsedSince(t0)}`);

    await uploadFile(page, path.join(FIXTURES_DIR, 'bank_statement_noisy.pdf'));
    console.log(`[bank-2] upload: ${elapsedSince(t0)}`);

    await waitForUploadCompletion(page, BANK_PIPELINE_TIMEOUT);
    console.log(`[bank-2] pipeline done: ${elapsedSince(t0)}`);

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

    const expectedCount = session!.transactions.length;
    const rowCount = await page.locator('tbody tr').count();
    expect(rowCount).toBe(expectedCount);
    console.log(`[bank-2] total: ${elapsedSince(t0)}`);
  });

  test('bank PDF -- flagged transactions', async ({ page }) => {
    test.setTimeout(LLM_TIMEOUT);
    const t0 = Date.now();

    await page.goto('/');
    console.log(`[bank-3] goto: ${elapsedSince(t0)}`);

    await uploadFile(page, path.join(FIXTURES_DIR, 'bank_statement_noisy.pdf'));
    console.log(`[bank-3] upload: ${elapsedSince(t0)}`);

    await waitForUploadCompletion(page, BANK_PIPELINE_TIMEOUT);
    console.log(`[bank-3] pipeline done: ${elapsedSince(t0)}`);

    await expect(page).toHaveURL(/\/review/);

    const session = await getReviewSession(page);
    expect(session).not.toBeNull();

    const report = session!.verificationReport;
    const rejected = report?.rejected as Array<Record<string, unknown>> ?? [];

    const summary = page.locator('text=Verification').first();
    const isSummaryVisible = await summary.isVisible().catch(() => false);

    if (rejected.length > 0) {
      if (isSummaryVisible) {
        await summary.click();
        await expect(page.getByText('Flagged Transactions')).toBeVisible();
      }
      expect(rejected.length).toBeGreaterThan(0);
    } else {
      if (isSummaryVisible) {
        await summary.click();
        await expect(page.getByText('Flagged Transactions')).not.toBeVisible();
      }
    }
    console.log(`[bank-3] total: ${elapsedSince(t0)}`);
  });

  // ── CC tests ─────────────────────────────────────────────────────────────────

  test('CC PDF -- statement totals verification flow', async ({ page }) => {
    test.setTimeout(CC_LLM_TIMEOUT);

    const fs = await import('fs');
    test.skip(!fs.existsSync(CC_PDF_FIXTURE), 'CC PDF fixture not found -- skipping');

    const consoleLogs = setupConsoleCapture(page);
    const t0 = Date.now();

    await page.goto('/');
    console.log(`[cc-1] goto: ${elapsedSince(t0)}`);

    await uploadFile(page, CC_PDF_FIXTURE, { statementType: 'credit_card', password: CC_PDF_PASSWORD });
    console.log(`[cc-1] upload+password: ${elapsedSince(t0)}`);

    try {
      await waitForUploadOrFailure(page, CC_PIPELINE_TIMEOUT);
    } catch (err) {
      dumpLogsOnFailure(consoleLogs, err);
    }
    console.log(`[cc-1] pipeline done: ${elapsedSince(t0)}`);

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
    console.log(`[cc-1] total: ${elapsedSince(t0)}`);
  });

  test('CC PDF -- verification report structure', async ({ page }) => {
    test.setTimeout(CC_LLM_TIMEOUT);

    const fs = await import('fs');
    test.skip(!fs.existsSync(CC_PDF_FIXTURE), 'CC PDF fixture not found -- skipping');

    const consoleLogs = setupConsoleCapture(page);
    const t0 = Date.now();

    await page.goto('/');
    console.log(`[cc-2] goto: ${elapsedSince(t0)}`);

    await uploadFile(page, CC_PDF_FIXTURE, { statementType: 'credit_card', password: CC_PDF_PASSWORD });
    console.log(`[cc-2] upload+password: ${elapsedSince(t0)}`);

    try {
      await waitForUploadOrFailure(page, CC_PIPELINE_TIMEOUT);
    } catch (err) {
      dumpLogsOnFailure(consoleLogs, err);
    }
    console.log(`[cc-2] pipeline done: ${elapsedSince(t0)}`);

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
    console.log(`[cc-2] total: ${elapsedSince(t0)}`);
  });
});
