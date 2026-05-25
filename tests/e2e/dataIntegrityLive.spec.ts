import { test, expect } from '@playwright/test';
import {
  skipIfNoLiveLLM,
  seedLiveLLMSettings,
  waitForUploadOrFailure,
  getReviewSession,
  getMerchantRules,
  getTransactionsFromStore,
  setupConsoleCapture,
  dumpLogsOnFailure,
  elapsedSince,
  FIXTURES_DIR,
} from '@tests/e2e/helpers/liveTestHelpers';
import { uploadFile } from '@tests/e2e/helpers/e2eHelpers';
import { clearAllStorage } from '@tests/utils/storageHelpers';
import * as path from 'path';

const BANK_FIXTURE = path.join(FIXTURES_DIR, 'bank_statement_noisy.pdf');
const PIPELINE_TIMEOUT = 300_000;

/**
 * Edit a transaction's category via the Edit (pencil) dialog.
 * If targetCategory is provided, selects that specific option.
 * Otherwise picks the last option (different from current).
 * Returns { newCategoryId, originalCategoryId }.
 */
async function editTransactionCategory(
  page: import('@playwright/test').Page,
  rowIndex: number,
  targetCategory?: string,
): Promise<{ newCategoryId: string; originalCategoryId: string }> {
  const editBtn = page.locator('tbody tr').nth(rowIndex).locator('td').last().locator('button').first();
  await editBtn.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  const categorySelect = dialog.locator('#edit-category');
  const originalCategoryId = await categorySelect.inputValue();

  let newCategoryId: string;
  if (targetCategory) {
    newCategoryId = targetCategory;
    await categorySelect.selectOption({ value: targetCategory });
  } else {
    const lastOptionValue = await categorySelect.locator('option').last().getAttribute('value');
    const options = await categorySelect.locator('option').allTextContents();
    expect(options.length).toBeGreaterThan(1);
    newCategoryId = lastOptionValue!;
    await categorySelect.selectOption({ value: lastOptionValue! });
  }

  await dialog.getByRole('button', { name: /save/i }).click();
  await expect(dialog).not.toBeVisible();

  return { newCategoryId, originalCategoryId };
}

/**
 * Manual upload flow that handles duplicate detection (Import Anyway dialog).
 * The uploadFile helper can't handle duplicates.
 */
async function uploadDuplicateFile(
  page: import('@playwright/test').Page,
  fixturePath: string,
): Promise<void> {
  const sidebarBtn = page.locator('button').filter({ hasText: /^Upload$/ }).first();
  const emptyStateBtn = page.getByRole('button', { name: 'Upload Statement', exact: true });
  const isDashboard = await sidebarBtn.isVisible().catch(() => false);
  if (isDashboard) {
    await sidebarBtn.click();
  } else {
    await emptyStateBtn.click();
  }
  await expect(page.getByText('Upload Your Statement')).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(100);
  await page.locator('#file-upload').setInputFiles(fixturePath);

  const importAnywayBtn = page.getByRole('button', { name: /import anyway/i });
  await expect(importAnywayBtn).toBeVisible({ timeout: 30_000 });
  await importAnywayBtn.click();
}

test.describe('Data Integrity — Live LLM', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ context }) => {
    skipIfNoLiveLLM();
    await clearAllStorage(context);
    await seedLiveLLMSettings(context);
  });

  test('editing category back to original does not learn a merchant rule', async ({ page }) => {
    test.setTimeout(600_000);
    const consoleLogs = setupConsoleCapture(page);
    const t0 = Date.now();

    await page.goto('/');
    await uploadFile(page, BANK_FIXTURE, { statementType: 'bank' });
    console.log(`[revert] upload: ${elapsedSince(t0)}`);

    try {
      await waitForUploadOrFailure(page, PIPELINE_TIMEOUT);
    } catch (err) {
      dumpLogsOnFailure(consoleLogs, err, 'revert');
    }
    console.log(`[revert] pipeline done: ${elapsedSince(t0)}`);

    await expect(page).toHaveURL(/\/review/);

    // Record rules before any edits
    const rulesBefore = await getMerchantRules(page);
    console.log(`[revert] rules before edit: ${rulesBefore.length}`);

    // Edit row 0 to a different category, then edit it BACK to the original
    const { originalCategoryId } = await editTransactionCategory(page, 0);
    console.log(`[revert] edited to different category, original was: ${originalCategoryId}`);

    // Now edit back to the original category
    await editTransactionCategory(page, 0, originalCategoryId);
    console.log(`[revert] edited back to original: ${originalCategoryId}`);

    // Confirm import
    await page.getByRole('button', { name: /confirm.*import/i }).click();
    await expect(page).not.toHaveURL(/\/review/, { timeout: 15_000 });
    console.log(`[revert] confirmed: ${elapsedSince(t0)}`);

    // No NEW rules should have been learned for this transaction
    // (the A→B→A edit is a no-op — pipeline only compares final vs original)
    const rulesAfter = await getMerchantRules(page);
    console.log(`[revert] rules after confirm: ${rulesAfter.length} (was ${rulesBefore.length})`);

    // The rule count should not have increased from this specific edit
    expect(rulesAfter.length).toBe(rulesBefore.length);

    console.log(`[revert] total: ${elapsedSince(t0)}`);
  });

  test('sequential imports without clearing storage preserve all transactions', async ({ page }) => {
    test.setTimeout(600_000);
    const consoleLogs = setupConsoleCapture(page);
    const t0 = Date.now();

    // ── Import 1 ──
    await page.goto('/');
    await uploadFile(page, BANK_FIXTURE, { statementType: 'bank' });
    console.log(`[sequential] import 1 upload: ${elapsedSince(t0)}`);

    try {
      await waitForUploadOrFailure(page, PIPELINE_TIMEOUT);
    } catch (err) {
      dumpLogsOnFailure(consoleLogs, err, 'sequential-1');
    }
    console.log(`[sequential] import 1 pipeline done: ${elapsedSince(t0)}`);

    await expect(page).toHaveURL(/\/review/);

    const session1 = await getReviewSession(page);
    expect(session1).not.toBeNull();
    const count1 = session1!.transactions.length;
    expect(count1).toBeGreaterThan(0);
    console.log(`[sequential] import 1: ${count1} transactions`);

    // Confirm import 1
    await page.getByRole('button', { name: /confirm.*import/i }).click();
    await expect(page).not.toHaveURL(/\/review/, { timeout: 15_000 });
    console.log(`[sequential] import 1 confirmed: ${elapsedSince(t0)}`);

    // Verify import 1 transactions are in the store
    const afterImport1 = await getTransactionsFromStore(page);
    expect(afterImport1.length).toBe(count1);

    // ── Import 2: Same file (triggers duplicate detection) ──
    await page.goto('/');
    await uploadDuplicateFile(page, BANK_FIXTURE);
    console.log(`[sequential] import 2 upload: ${elapsedSince(t0)}`);

    try {
      await waitForUploadOrFailure(page, PIPELINE_TIMEOUT);
    } catch (err) {
      dumpLogsOnFailure(consoleLogs, err, 'sequential-2');
    }
    console.log(`[sequential] import 2 pipeline done: ${elapsedSince(t0)}`);

    await expect(page).toHaveURL(/\/review/);

    const session2 = await getReviewSession(page);
    expect(session2).not.toBeNull();
    const count2 = session2!.transactions.length;
    expect(count2).toBeGreaterThan(0);
    console.log(`[sequential] import 2: ${count2} transactions`);

    // Confirm import 2
    await page.getByRole('button', { name: /confirm.*import/i }).click();
    await expect(page).not.toHaveURL(/\/review/, { timeout: 15_000 });
    console.log(`[sequential] import 2 confirmed: ${elapsedSince(t0)}`);

    // ── Verify: total = import 1 + import 2 ──
    const afterImport2 = await getTransactionsFromStore(page);
    const expectedTotal = count1 + count2;
    console.log(
      `[sequential] final store: ${afterImport2.length} transactions (expected ${count1} + ${count2} = ${expectedTotal})`,
    );

    expect(
      afterImport2.length,
      `Expected ${expectedTotal} transactions (${count1} from import 1 + ${count2} from import 2), got ${afterImport2.length}`,
    ).toBe(expectedTotal);

    // Navigate to transactions page and verify UI matches
    await page.goto('/transactions');

    // Wait for Zustand persist to rehydrate from localStorage before counting rows.
    // domcontentloaded fires before hydration, so the empty-state row (1 <tr>) would be counted.
    await expect(page.locator('tbody tr')).toHaveCount(expectedTotal, { timeout: 10_000 });

    console.log(`[sequential] total: ${elapsedSince(t0)}`);
  });
});
