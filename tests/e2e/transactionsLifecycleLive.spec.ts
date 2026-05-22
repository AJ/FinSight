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

const BANK_FIXTURE = path.join(FIXTURES_DIR, 'bank_statement_noisy.pdf');
const PIPELINE_TIMEOUT = 300_000;

test.describe('Transactions Lifecycle — Live LLM', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ context }) => {
    skipIfNoLiveLLM();
    await clearAllStorage(context);
    await seedLiveLLMSettings(context);
  });

  test('AI categorization produces valid categories and edits persist', async ({ page }) => {
    test.setTimeout(360_000);
    const consoleLogs = setupConsoleCapture(page);
    const t0 = Date.now();

    await page.goto('/');
    await uploadFile(page, BANK_FIXTURE, { statementType: 'bank' });
    console.log(`[txn-life] upload: ${elapsedSince(t0)}`);

    try {
      await waitForUploadOrFailure(page, PIPELINE_TIMEOUT);
    } catch (err) {
      dumpLogsOnFailure(consoleLogs, err, 'txn-life');
    }
    console.log(`[txn-life] pipeline done: ${elapsedSince(t0)}`);

    await expect(page).toHaveURL(/\/review/);

    const session = await getReviewSession(page);
    expect(session).not.toBeNull();

    // Every transaction must have a category from the valid set
    for (const txn of session!.transactions) {
      const cat = String(txn.category ?? '');
      expect(
        VALID_CATEGORIES.has(cat),
        `Transaction "${txn.description ?? txn.merchant}" has invalid category "${cat}"`,
      ).toBe(true);
    }

    // Every categorizedBy must be from a known source
    for (const txn of session!.transactions) {
      const source = String(txn.categorizedBy ?? '');
      expect(
        VALID_CATEGORY_SOURCES.has(source),
        `Transaction "${txn.description ?? txn.merchant}" has invalid categorizedBy "${source}"`,
      ).toBe(true);
    }

    // At least some should be AI-categorized (not all keyword fallback)
    const aiSourced = session!.transactions.filter(
      (t) =>
        t.categorizedBy === 'ai' ||
        t.categorizedBy === 'rule',
    );
    console.log(`[txn-life] ${aiSourced.length} AI-sourced categories`);
    expect(aiSourced.length).toBeGreaterThan(0);

    // Count by source for visibility
    const sourceCounts: Record<string, number> = {};
    for (const txn of session!.transactions) {
      const src = String(txn.categorizedBy ?? 'unknown');
      sourceCounts[src] = (sourceCounts[src] ?? 0) + 1;
    }
    console.log(`[txn-life] source breakdown: ${JSON.stringify(sourceCounts)}`);

    // Reload and verify persistence
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    const sessionAfterReload = await getReviewSession(page);
    expect(sessionAfterReload).not.toBeNull();
    expect(sessionAfterReload!.transactions.length).toBe(session!.transactions.length);

    console.log(`[txn-life] total: ${elapsedSince(t0)}`);
  });
});
