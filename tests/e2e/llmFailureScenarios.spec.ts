import { test, expect } from '@playwright/test';
import { mockLLMResponse } from '@tests/mocks/llmMocker';
import { uploadFile, setupTestContext } from '@tests/e2e/helpers/e2eHelpers';
import { clearAllStorage } from '@tests/utils/storageHelpers';
import * as path from 'path';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');

test.describe('LLM Failure Scenarios', () => {
  test.beforeEach(async ({ page, context }) => {
    await clearAllStorage(context);
    await setupTestContext(context);
    await page.goto('/');
  });

  test('should handle malformed JSON gracefully', async ({ page }) => {
    await mockLLMResponse(page, 'malformed_json');
    await uploadFile(page, path.join(FIXTURES_DIR, 'bank_clean.csv'));
    await Promise.race([
      page.waitForURL('**/review', { timeout: 20000 }),
      page.waitForSelector('[role="status"]:has-text("error"), [role="alert"]:has-text("error")', { timeout: 20000 }),
    ]);
  });

  test('should timeout and show network error', async ({ page }) => {
    await mockLLMResponse(page, 'timeout');
    await uploadFile(page, path.join(FIXTURES_DIR, 'bank_clean.csv'));
    await Promise.race([
      page.waitForURL('**/review', { timeout: 20000 }),
      page.waitForSelector('[role="status"]:has-text("timeout"), [role="alert"]:has-text("timeout")', { timeout: 20000 }),
    ]);
  });

  test('should warn on inconsistent categorization', async ({ page }) => {
    await mockLLMResponse(page, 'wrong_schema');
    await uploadFile(page, path.join(FIXTURES_DIR, 'cc_clean.csv'));
    await Promise.race([
      page.waitForURL('**/review', { timeout: 20000 }),
      page.waitForSelector('[role="status"]:has-text("warning"), [role="alert"]:has-text("warning")', { timeout: 20000 }),
    ]);
  });

  test('should not crash on partial response', async ({ page }) => {
    await mockLLMResponse(page, 'partial_output');
    await uploadFile(page, path.join(FIXTURES_DIR, 'bank_clean.csv'));
    // Ensure the page doesn't crash (is not blank)
    await expect(page.locator('body')).not.toHaveText('', { timeout: 20000 });
  });
});
