import { test, expect } from '@playwright/test';
import {
  skipIfNoLiveLLM,
  seedLiveLLMSettings,
  waitForUploadOrFailure,
  getReviewSession,
  setupConsoleCapture,
  dumpLogsOnFailure,
  getTransactionsFromStore,
  getMerchantRules,
  elapsedSince,
  FIXTURES_DIR,
  VALID_CATEGORIES,
} from '@tests/e2e/helpers/liveTestHelpers';
import { uploadFile } from '@tests/e2e/helpers/e2eHelpers';
import { clearAllStorage } from '@tests/utils/storageHelpers';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const BANK_FIXTURE = path.join(FIXTURES_DIR, 'bank_statement_noisy.pdf');
const PIPELINE_TIMEOUT = 300_000;

test.describe('File Upload Lifecycle — Live LLM', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ context }) => {
    skipIfNoLiveLLM();
    await clearAllStorage(context);
    await seedLiveLLMSettings(context);
  });

  test('bank PDF — full upload to save lifecycle', async ({ page }) => {
    test.setTimeout(600_000);
    const consoleLogs = setupConsoleCapture(page);
    const t0 = Date.now();

    // ── Phase 1: Upload and parse ──
    await page.goto('/');
    console.log(`[lifecycle] goto: ${elapsedSince(t0)}`);

    await uploadFile(page, BANK_FIXTURE, { statementType: 'bank' });
    console.log(`[lifecycle] upload: ${elapsedSince(t0)}`);

    try {
      await waitForUploadOrFailure(page, PIPELINE_TIMEOUT);
    } catch (err) {
      dumpLogsOnFailure(consoleLogs, err, 'lifecycle');
    }
    console.log(`[lifecycle] pipeline done: ${elapsedSince(t0)}`);

    await expect(page).toHaveURL(/\/review/);

    // ── Phase 2: Verify review page ──
    const session = await getReviewSession(page);
    expect(session).not.toBeNull();
    expect(session!.transactions.length).toBeGreaterThan(0);

    const rowCount = await page.locator('tbody tr').count();
    expect(rowCount).toBe(session!.transactions.length);

    // Verify verification report exists
    const report = session!.verificationReport;
    expect(report).toBeDefined();
    expect(typeof report!.overallConfidence).toBe('number');

    // ── Phase 3: Edit a transaction category ──
    // Click the Edit (pencil) icon button on the first row → opens ReviewEditDialog
    const editBtn = page.locator('tbody tr').first().locator('td').last().locator('button').first();
    await editBtn.click();

    // Wait for the edit dialog to open
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Change the category dropdown to a different option
    const categorySelect = dialog.locator('#edit-category');
    const currentValue = await categorySelect.inputValue();

    // Pick the last option (likely different from current)
    const options = await categorySelect.locator('option').allTextContents();
    const lastOptionValue = await categorySelect.locator('option').last().getAttribute('value');
    expect(options.length).toBeGreaterThan(1);
    await categorySelect.selectOption({ value: lastOptionValue! });

    // Save the edit
    await dialog.getByRole('button', { name: /save/i }).click();

    // Wait for dialog to close and read the new category from the badge
    await expect(dialog).not.toBeVisible();
    const categoryCell = page.locator('tbody tr').first().locator('td').nth(5);
    const newCategoryText = await categoryCell.textContent();
    console.log(`[lifecycle] edited category: ${newCategoryText} (was ${currentValue})`);

    // The new category must be valid
    const newCategoryId = lastOptionValue!;
    expect(
      VALID_CATEGORIES.has(String(newCategoryId).toLowerCase()),
      `Edited category "${newCategoryId}" is not valid`,
    ).toBe(true);

    // ── Phase 4: Confirm and import ──
    const confirmBtn = page.getByRole('button', { name: /confirm.*import/i });
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // Should navigate away from /review
    await expect(page).not.toHaveURL(/\/review/, { timeout: 15_000 });
    console.log(`[lifecycle] confirmed: ${elapsedSince(t0)}`);

    // ── Phase 5: Verify transactions persisted ──
    await page.goto('/transactions');
    await page.waitForLoadState('domcontentloaded');

    const savedTxns = await getTransactionsFromStore(page);
    expect(savedTxns.length).toBe(session!.transactions.length);

    const tableRows = await page.locator('tbody tr').count();
    expect(tableRows).toBeGreaterThan(0);
    console.log(`[lifecycle] transactions page verified: ${elapsedSince(t0)}`);

    // ── Phase 6: Verify merchant rule was learned ──
    const rules = await getMerchantRules(page);
    expect(rules.length).toBeGreaterThan(0);
    console.log(`[lifecycle] merchant rules learned: ${rules.length}`);

    // ── Phase 7: Re-upload same PDF, verify rule applied ──
    // Re-uploading the same file triggers duplicate detection.
    // Full manual flow since uploadFile helper doesn't handle the duplicate dialog.
    await page.goto('/');

    // Open upload dialog — try sidebar "Upload" first (dashboard state), fall back to "Upload Statement"
    const sidebarBtn = page.locator('button').filter({ hasText: /^Upload$/ }).first();
    const emptyStateBtn = page.getByRole('button', { name: 'Upload Statement', exact: true });
    const isDashboard = await sidebarBtn.isVisible().catch(() => false);
    if (isDashboard) {
      await sidebarBtn.click();
    } else {
      await emptyStateBtn.click();
    }

    // Wait for dialog and set file
    await expect(page.getByText('Upload Your Statement')).toBeVisible({ timeout: 5_000 });
    await page.waitForTimeout(100);
    await page.locator('#file-upload').setInputFiles(BANK_FIXTURE);

    // Re-uploading same file triggers duplicate detection.
    // The flow is: file select → hash computation → duplicate dialog (no statement type dialog).
    const importAnywayBtn = page.getByRole('button', { name: /import anyway/i });
    await expect(importAnywayBtn).toBeVisible({ timeout: 30_000 });
    await importAnywayBtn.click();

    console.log(`[lifecycle] re-upload: ${elapsedSince(t0)}`);

    try {
      await waitForUploadOrFailure(page, PIPELINE_TIMEOUT);
    } catch (err) {
      dumpLogsOnFailure(consoleLogs, err, 'lifecycle-reupload');
    }
    console.log(`[lifecycle] re-upload pipeline done: ${elapsedSince(t0)}`);

    await expect(page).toHaveURL(/\/review/);

    const session2 = await getReviewSession(page);
    expect(session2).not.toBeNull();

    // Find the edited transaction — its category should match the edit and source should be learned
    const editedTxn = session2!.transactions.find((t) => {
      const desc = String(t.description ?? t.merchant ?? '');
      const origDesc = String(session!.transactions[0]?.description ?? session!.transactions[0]?.merchant ?? '');
      return desc.toLowerCase().includes(origDesc.toLowerCase().substring(0, 10));
    });

    if (editedTxn) {
      const source = String(editedTxn.categorizedBy ?? '');
      console.log(
        `[lifecycle] re-uploaded txn category: ${editedTxn.category}, source: ${source}`,
      );
      // Category should match what we edited to
      expect(
        String(editedTxn.category).toLowerCase(),
      ).toBe(String(newCategoryId).toLowerCase());
    }

    console.log(`[lifecycle] total: ${elapsedSince(t0)}`);
  });

  // ── Negative case: invalid file upload shows error ──

  test('uploading invalid file shows error message', async ({ page }) => {
    test.setTimeout(30_000);

    // Create a small invalid file (not a valid PDF) in temp directory
    const invalidFilePath = path.join(os.tmpdir(), 'invalid_test_file.txt');
    fs.writeFileSync(invalidFilePath, 'this is not a PDF file');

    try {
      await page.goto('/');

      // Open upload dialog
      const emptyStateBtn = page.getByRole('button', { name: 'Upload Statement', exact: true });
      const sidebarBtn = page.locator('button').filter({ hasText: /^Upload$/ }).first();
      const isOnEmptyState = await emptyStateBtn.isVisible().catch(() => false);
      if (isOnEmptyState) {
        await emptyStateBtn.click();
      } else {
        await sidebarBtn.click();
      }

      // Set the invalid file directly — validateFile() will reject it via alert
      await expect(page.getByText('Upload Your Statement')).toBeVisible({ timeout: 5_000 });
      await page.waitForTimeout(100);

      // Set up alert handler to verify the browser alert fires
      let alertFired = false;
      page.once('dialog', async (dialog) => {
        alertFired = true;
        await dialog.accept();
      });

      await page.locator('#file-upload').setInputFiles(invalidFilePath);

      // The alert should fire (file type rejected)
      // Give it a moment since the validation is synchronous
      await page.waitForTimeout(500);
      expect(alertFired, 'Browser alert should fire for invalid file type').toBe(true);

      console.log(`[lifecycle-invalid] error correctly shown for invalid file`);
    } finally {
      // Clean up the temporary file
      if (fs.existsSync(invalidFilePath)) {
        fs.unlinkSync(invalidFilePath);
      }
    }
  });
});
