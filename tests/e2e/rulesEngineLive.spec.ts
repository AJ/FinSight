import { test, expect } from '@playwright/test';
import {
  skipIfNoLiveLLM,
  seedLiveLLMSettings,
  waitForUploadOrFailure,
  getReviewSession,
  getMerchantRules,
  setupConsoleCapture,
  dumpLogsOnFailure,
  elapsedSince,
  FIXTURES_DIR,
  VALID_CATEGORIES,
} from '@tests/e2e/helpers/liveTestHelpers';
import { uploadFile } from '@tests/e2e/helpers/e2eHelpers';
import { clearAllStorage } from '@tests/utils/storageHelpers';
import * as path from 'path';

const BANK_FIXTURE = path.join(FIXTURES_DIR, 'bank_statement_noisy.pdf');
const PIPELINE_TIMEOUT = 300_000;

/**
 * Edit a transaction's category via the Edit (pencil) dialog.
 * Returns the new category ID.
 */
async function editTransactionCategory(
  page: import('@playwright/test').Page,
  rowIndex: number,
): Promise<string> {
  const editBtn = page.locator('tbody tr').nth(rowIndex).locator('td').last().locator('button').first();
  await editBtn.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  const categorySelect = dialog.locator('#edit-category');
  const lastOptionValue = await categorySelect.locator('option').last().getAttribute('value');
  const options = await categorySelect.locator('option').allTextContents();
  expect(options.length).toBeGreaterThan(1);
  await categorySelect.selectOption({ value: lastOptionValue! });

  await dialog.getByRole('button', { name: /save/i }).click();
  await expect(dialog).not.toBeVisible();

  return lastOptionValue!;
}

test.describe('Rules Engine — Live LLM', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ context }) => {
    skipIfNoLiveLLM();
    await clearAllStorage(context);
    await seedLiveLLMSettings(context);
  });

  test('learned rule overrides AI categorization on re-upload', async ({ page }) => {
    test.setTimeout(600_000);
    const consoleLogs = setupConsoleCapture(page);
    const t0 = Date.now();

    // ── Upload 1: Process and confirm ──
    await page.goto('/');
    await uploadFile(page, BANK_FIXTURE, { statementType: 'bank' });
    console.log(`[rules] upload 1: ${elapsedSince(t0)}`);

    try {
      await waitForUploadOrFailure(page, PIPELINE_TIMEOUT);
    } catch (err) {
      dumpLogsOnFailure(consoleLogs, err, 'rules');
    }
    console.log(`[rules] pipeline 1 done: ${elapsedSince(t0)}`);

    await expect(page).toHaveURL(/\/review/);

    const session1 = await getReviewSession(page);
    expect(session1).not.toBeNull();

    // Remember the first transaction's identity for matching later
    const firstTxn = session1!.transactions[0];
    const firstTxnDesc = String(firstTxn?.description ?? firstTxn?.merchant ?? '');

    // Edit first transaction's category via Edit dialog
    const editedCategory = await editTransactionCategory(page, 0);
    console.log(`[rules] edited first txn to: ${editedCategory}`);

    // The edited category must be a valid category
    expect(
      VALID_CATEGORIES.has(String(editedCategory).toLowerCase()),
      `Edited category "${editedCategory}" is not a valid category`,
    ).toBe(true);

    // Confirm import
    await page.getByRole('button', { name: /confirm.*import/i }).click();
    await expect(page).not.toHaveURL(/\/review/, { timeout: 15_000 });
    console.log(`[rules] import confirmed: ${elapsedSince(t0)}`);

    // Verify merchant rule was learned
    const rules = await getMerchantRules(page);
    expect(rules.length).toBeGreaterThan(0);
    console.log(`[rules] rules learned: ${rules.length}`);

    // ── Upload 2: Same file triggers duplicate detection ──
    // uploadFile helper can't handle duplicates — use manual flow
    await page.goto('/');
    const sidebarBtn2 = page.locator('button').filter({ hasText: /^Upload$/ }).first();
    const emptyStateBtn2 = page.getByRole('button', { name: 'Upload Statement', exact: true });
    const isDashboard2 = await sidebarBtn2.isVisible().catch(() => false);
    if (isDashboard2) {
      await sidebarBtn2.click();
    } else {
      await emptyStateBtn2.click();
    }
    await expect(page.getByText('Upload Your Statement')).toBeVisible({ timeout: 5_000 });
    await page.waitForTimeout(100);
    await page.locator('#file-upload').setInputFiles(BANK_FIXTURE);

    // Duplicate dialog appears instead of statement type dialog
    const importAnywayBtn = page.getByRole('button', { name: /import anyway/i });
    await expect(importAnywayBtn).toBeVisible({ timeout: 30_000 });
    await importAnywayBtn.click();

    console.log(`[rules] upload 2: ${elapsedSince(t0)}`);

    try {
      await waitForUploadOrFailure(page, PIPELINE_TIMEOUT);
    } catch (err) {
      dumpLogsOnFailure(consoleLogs, err, 'rules-reupload');
    }
    console.log(`[rules] pipeline 2 done: ${elapsedSince(t0)}`);

    await expect(page).toHaveURL(/\/review/);

    const session2 = await getReviewSession(page);
    expect(session2).not.toBeNull();

    // Find the same transaction by description and verify the rule was applied
    const matchedTxn = session2!.transactions.find((t) => {
      const desc = String(t.description ?? t.merchant ?? '');
      return desc.toLowerCase().includes(firstTxnDesc.toLowerCase().substring(0, 10));
    });

    expect(matchedTxn).toBeDefined();
    expect(
      matchedTxn!.categorizedBy === 'rule',
      `Expected categorizedBy 'rule', got '${matchedTxn!.categorizedBy}'`,
    ).toBe(true);

    // The category must match the edit we made
    expect(
      String(matchedTxn!.category).toLowerCase(),
    ).toBe(String(editedCategory).toLowerCase());

    console.log(
      `[rules] verified: txn "${firstTxnDesc.substring(0, 20)}..." → category=${matchedTxn!.category}, source=${matchedTxn!.categorizedBy}`,
    );

    console.log(`[rules] total: ${elapsedSince(t0)}`);
  });

  test('editing two transactions before confirm preserves both edits', async ({ page }) => {
    test.setTimeout(600_000);
    const consoleLogs = setupConsoleCapture(page);
    const t0 = Date.now();

    await page.goto('/');
    await uploadFile(page, BANK_FIXTURE, { statementType: 'bank' });
    console.log(`[rules-multi] upload: ${elapsedSince(t0)}`);

    try {
      await waitForUploadOrFailure(page, PIPELINE_TIMEOUT);
    } catch (err) {
      dumpLogsOnFailure(consoleLogs, err, 'rules-multi');
    }
    console.log(`[rules-multi] pipeline done: ${elapsedSince(t0)}`);

    await expect(page).toHaveURL(/\/review/);

    // Edit first and second transactions via Edit dialog
    const firstEdit = await editTransactionCategory(page, 0);
    console.log(`[rules-multi] edit 1: ${firstEdit}`);

    const secondEdit = await editTransactionCategory(page, 1);
    console.log(`[rules-multi] edit 2: ${secondEdit}`);

    // Both edits must be valid categories
    expect(VALID_CATEGORIES.has(String(firstEdit).toLowerCase())).toBe(true);
    expect(VALID_CATEGORIES.has(String(secondEdit).toLowerCase())).toBe(true);

    // Confirm — both edits should be preserved
    await page.getByRole('button', { name: /confirm.*import/i }).click();
    await expect(page).not.toHaveURL(/\/review/, { timeout: 15_000 });
    console.log(`[rules-multi] confirmed: ${elapsedSince(t0)}`);

    // Verify multiple rules learned
    const rules = await getMerchantRules(page);
    expect(rules.length).toBeGreaterThanOrEqual(2);
    console.log(`[rules-multi] rules learned: ${rules.length}`);

    console.log(`[rules-multi] total: ${elapsedSince(t0)}`);
  });
});
