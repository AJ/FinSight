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

const CC_PDF_FIXTURE = path.join(FIXTURES_DIR, 'cc_statement.pdf');
const CC_PDF_PASSWORD = process.env.CC_PDF_PASSWORD || undefined;

// ── Tests ────────────────────────────────────────────────────────────────────────

test.describe('Balance Reconciliation -- Live LLM E2E', () => {
  // Run with --workers=1 to avoid GPU VRAM exhaustion from parallel LLM calls.
  // Not using serial mode because test 1 has a known soft failure (reconciliation gap)
  // and serial mode would skip all subsequent tests on any failure.

  // Playwright test timeout (hard ceiling for the entire test)
  const LLM_TIMEOUT = 300_000;
  const CC_LLM_TIMEOUT = 600_000;

  // waitForURL timeout — how long we wait for pipeline to complete.
  // Separate from test timeout so the test fails fast on pipeline errors.
  const BANK_PIPELINE_TIMEOUT = 240_000;
  const CC_PIPELINE_TIMEOUT = 540_000;

  test.beforeEach(async ({ context }) => {
    skipIfNoLiveLLM();
    await clearAllStorage(context);
    await seedLiveLLMSettings(context);
  });

  // ── Bank tests ───────────────────────────────────────────────────────────────

  test('bank PDF -- full reconciliation flow', async ({ page }) => {
    test.setTimeout(LLM_TIMEOUT);
    const t0 = Date.now();

    await page.goto('/');
    console.log(`[bank-1] goto: ${elapsedSince(t0)}`);

    await uploadFile(page, path.join(FIXTURES_DIR, 'bank_statement_noisy.pdf'));
    console.log(`[bank-1] upload: ${elapsedSince(t0)}`);

    await waitForUploadOrFailure(page, BANK_PIPELINE_TIMEOUT);
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

    // Log reconciliation values regardless of outcome
    console.log(
      `[bank-1] reconciliation: passed=${reconciliation!.passed}, ` +
      `computedClosing=${reconciliation!.computedClosing}, ` +
      `expectedClosing=${reconciliation!.expectedClosing}, ` +
      `difference=${reconciliation!.difference}`,
    );

    // KNOWN GAP: reconciliation rarely passes with current LLM extraction accuracy.
    // Using soft assertion so the gap is reported without killing the test.
    expect.soft(reconciliation!.passed, 'Bank reconciliation gap — see logged values above').toBe(true);

    const confidence = report!.overallConfidence as number;
    expect(typeof confidence).toBe('number');
    console.log(`[bank-1] overallConfidence: ${confidence}`);

    // Verify verification status is visible (either passed or failed — both are valid)
    const verificationEl = page.locator('text=Verification').first();
    await expect(verificationEl).toBeVisible({ timeout: 10_000 });

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

    await waitForUploadOrFailure(page, BANK_PIPELINE_TIMEOUT);
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

    await waitForUploadOrFailure(page, BANK_PIPELINE_TIMEOUT);
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
      // Each rejected item is a Transaction with insufficient verification confidence
      for (const r of rejected) {
        expect(r.date).toBeDefined();
        expect(typeof r.amount).toBe('number');
        expect(r.description || r.merchant).toBeDefined();
      }
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
      dumpLogsOnFailure(consoleLogs, err, 'cc-1');
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

    // Log CC reconciliation values regardless of outcome
    console.log(
      `[cc-1] statementTotals: passed=${statementTotals!.passed}, ` +
      `computedTotalDue=${statementTotals!.computedTotalDue}, ` +
      `expectedTotalDue=${statementTotals!.expectedTotalDue}`,
    );

    // KNOWN GAP: CC reconciliation rarely passes with current LLM extraction accuracy.
    expect.soft(statementTotals!.passed, 'CC statementTotals gap — see logged values above').toBe(true);

    const confidence = report!.overallConfidence as number;
    expect(typeof confidence).toBe('number');
    console.log(`[cc-1] overallConfidence: ${confidence}`);

    // Verify verification status is visible (either passed or failed — both are valid)
    const verificationEl = page.locator('text=Verification').first();
    await expect(verificationEl).toBeVisible({ timeout: 10_000 });

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
      dumpLogsOnFailure(consoleLogs, err, 'cc-2');
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
