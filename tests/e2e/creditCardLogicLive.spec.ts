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
  VALID_CATEGORIES,
  VALID_CATEGORY_SOURCES,
} from '@tests/e2e/helpers/liveTestHelpers';
import { uploadFile } from '@tests/e2e/helpers/e2eHelpers';
import { clearAllStorage } from '@tests/utils/storageHelpers';
import * as path from 'path';
import * as fs from 'fs';

const CC_FIXTURE = path.join(FIXTURES_DIR, 'cc_statement.pdf');
const CC_PDF_PASSWORD = process.env.CC_PDF_PASSWORD || undefined;
const PIPELINE_TIMEOUT = 540_000;

test.describe('CC Logic — Live LLM', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ context }) => {
    skipIfNoLiveLLM();
    test.skip(!fs.existsSync(CC_FIXTURE), 'CC PDF fixture not found — skipping');
    await clearAllStorage(context);
    await seedLiveLLMSettings(context);
  });

  test('CC PDF — full 3-pass pipeline with valid data', async ({ page }) => {
    test.setTimeout(600_000);
    const consoleLogs = setupConsoleCapture(page);
    const t0 = Date.now();

    await page.goto('/');
    await uploadFile(page, CC_FIXTURE, { statementType: 'credit_card', password: CC_PDF_PASSWORD });
    console.log(`[cc-logic] upload: ${elapsedSince(t0)}`);

    try {
      await waitForUploadOrFailure(page, PIPELINE_TIMEOUT);
    } catch (err) {
      dumpLogsOnFailure(consoleLogs, err, 'cc-logic');
    }
    console.log(`[cc-logic] pipeline done: ${elapsedSince(t0)}`);

    await expect(page).toHaveURL(/\/review/);

    const session = await getReviewSession(page);
    expect(session).not.toBeNull();
    expect(session!.transactions.length).toBeGreaterThan(0);

    // All transactions must have valid structure with well-formed data
    for (const txn of session!.transactions) {
      // Date must parse to a valid Date object
      const d = new Date(String(txn.date));
      expect(!isNaN(d.getTime()), `Invalid date: "${txn.date}"`).toBe(true);

      // Amount must be a number and not NaN
      const amount = Number(txn.amount);
      expect(!isNaN(amount), `Amount is NaN for "${txn.description ?? txn.merchant}"`).toBe(true);

      // Type must be credit or debit
      expect(txn.type).toMatch(/^(credit|debit)$/);

      // Must have a description or merchant
      expect(txn.description || txn.merchant).toBeDefined();

      // Category must be from valid set
      const cat = String(txn.category ?? '');
      expect(
        VALID_CATEGORIES.has(cat),
        `CC transaction "${txn.description ?? txn.merchant}" has invalid category "${cat}"`,
      ).toBe(true);

      // categorizedBy must be from valid set
      const source = String(txn.categorizedBy ?? '');
      expect(
        VALID_CATEGORY_SOURCES.has(source),
        `CC transaction has invalid categorizedBy "${source}"`,
      ).toBe(true);
    }

    // Debit amounts should be positive (direction is in the type field, not the sign)
    const debits = session!.transactions.filter((t) => t.type === 'debit');
    for (const txn of debits) {
      const debitAmount = Number(txn.amount);
      expect(
        debitAmount > 0,
        `Debit amount should be positive, got ${debitAmount} for "${txn.description ?? txn.merchant}"`,
      ).toBe(true);
    }

    // Transaction rows visible in UI
    const rowCount = await page.locator('tbody tr').count();
    expect(rowCount).toBe(session!.transactions.length);

    // CC summary fields should be present
    const summary = session!.statementSummary as Record<string, unknown> | null | undefined;
    if (summary) {
      expect(typeof summary.statementDate).toBe('string');
      expect(typeof summary.paymentDueDate).toBe('string');
      expect(typeof summary.totalDue).toBe('number');
      console.log(`[cc-logic] summary: totalDue=${summary.totalDue}, due=${summary.paymentDueDate}`);

      // Rewards section populated when applicable
      const rewards = summary.rewardPoints as Record<string, unknown> | null;
      if (rewards) {
        expect(typeof rewards.earned).toBe('number');
        console.log(`[cc-logic] rewards: earned=${rewards.earned}`);
      }
    }

    console.log(`[cc-logic] total: ${elapsedSince(t0)}`);
  });
});
