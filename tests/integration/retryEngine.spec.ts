import { test, expect } from '@playwright/test';
import { mockLLMResponse } from '@tests/mocks/llmMocker';
import { uploadFile, setupTestContext } from '@tests/e2e/helpers/e2eHelpers';
import { clearAllStorage } from '@tests/utils/storageHelpers';
import * as path from 'path';

// PDF fixture — CSV files bypass LLM extraction entirely (direct parseCSV path),
// so we need a PDF to actually trigger the LLM retry loop.
const PDF_FIXTURE = path.resolve(__dirname, '../../public/test.pdf');
const PDF_PASSWORD = 'REDACTED';

test.describe('retryEngine Prompt Evolution', () => {
  test.beforeEach(async ({ page, context }) => {
    await clearAllStorage(context);
    await setupTestContext(context);
    await page.goto('/');
  });

  test('should inject validation error into retry prompt', async ({ page }) => {
    test.slow(); // PDF + LLM retries can take a while

    const mockResult = await mockLLMResponse(page, 'wrong_schema');

    await uploadFile(page, PDF_FIXTURE, { password: PDF_PASSWORD });

    // The PDF + LLM retry flow can take a while. Wait for any sign of completion:
    // URL change, error toast, or sufficient page content
    await Promise.race([
      page.waitForURL('**/review', { timeout: 120000 }),
      page.waitForSelector('[role="status"], [role="alert"]', { timeout: 120000 }),
      page.waitForFunction(() => {
        const text = document.body.innerText;
        return text.includes('error') || text.includes('Error') || text.length > 500;
      }, { timeout: 120000 }),
    ]);

    // Check all captured prompts for retry context
    const prompts = mockResult.getCapturedPrompts();
    const retryPrompt = prompts.find((p: string) => p.includes('VALIDATION ERRORS TO FIX'));

    expect(retryPrompt).toBeDefined();
  });
});
