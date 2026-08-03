import { test, expect } from '@playwright/test';
import {
  skipIfNoLiveLLM,
  seedLiveLLMSettings,
  seedTransactions,
  elapsedSince,
} from '@tests/e2e/helpers/liveTestHelpers';
import { clearAllStorage } from '@tests/utils/storageHelpers';
import { LLM_TEST_TIMEOUT } from '@tests/e2e/helpers/liveTimeouts';

// Sample transactions for chat context
const SAMPLE_TRANSACTIONS = [
  {
    id: 'test-1',
    date: '2025-08-01',
    description: 'AMAZON INDIA',
    amount: 1299,
    type: 'debit',
    category: 'shopping',
    localCurrency: { code: 'INR', symbol: '₹' },
  },
  {
    id: 'test-2',
    date: '2025-08-05',
    description: 'SWIGGY',
    amount: 450,
    type: 'debit',
    category: 'dining',
    localCurrency: { code: 'INR', symbol: '₹' },
  },
  {
    id: 'test-3',
    date: '2025-08-10',
    description: 'SALARY CREDIT',
    amount: 75000,
    type: 'credit',
    category: 'income',
    localCurrency: { code: 'INR', symbol: '₹' },
  },
];

test.describe('Chat With Data — Live LLM', () => {
  test.describe.configure({ mode: 'serial' });

  test('sends message and receives streaming response', async ({ context, page }) => {
    skipIfNoLiveLLM();
    test.setTimeout(LLM_TEST_TIMEOUT);
    await clearAllStorage(context);
    await seedLiveLLMSettings(context);
    await seedTransactions(context, SAMPLE_TRANSACTIONS);

    const t0 = Date.now();

    await page.goto('/chat');
    console.log(`[chat] goto: ${elapsedSince(t0)}`);

    // Verify chat page loaded
    await expect(page.getByText(/chat with your/i)).toBeVisible({ timeout: 10_000 });

    // Type a message
    const textarea = page.locator('textarea');
    await textarea.fill('How much did I spend on shopping?');
    console.log(`[chat] typed message: ${elapsedSince(t0)}`);

    // Send it
    await textarea.press('Enter');

    // Wait for response to appear (assistant message bubble)
    const assistantMsg = page.locator('.bg-muted, [class*="bg-muted"]').filter({
      hasText: /₹|1299|shopping|spend/i,
    });
    await expect(assistantMsg).toBeVisible({ timeout: 60_000 });
    console.log(`[chat] response received: ${elapsedSince(t0)}`);

    // Verify no error state
    await expect(page.getByText(/error|failed|unable to/i)).not.toBeVisible();

    console.log(`[chat] total: ${elapsedSince(t0)}`);
  });

  // NOTE: a "streaming delivers tokens progressively" test lived here. It sampled the on-screen
  // answer length and required growth — racy on fast local models (a short answer arrives within
  // one sample window) and unable to distinguish "streamed fast" from "not streamed at all".
  // Progressive streaming is now covered reliably at two deterministic layers:
  //   - chatStreamProgressiveLive.spec.ts: the real LLM streams multiple chunks over the wire.
  //   - tests/unit/llm/chatStreamProgressive.spec.ts: chatStream yields each chunk separately.

  test('suggestion chip sends pre-built query', async ({ context, page }) => {
    skipIfNoLiveLLM();
    test.setTimeout(LLM_TEST_TIMEOUT);
    await clearAllStorage(context);
    await seedLiveLLMSettings(context);
    await seedTransactions(context, SAMPLE_TRANSACTIONS);

    await page.goto('/chat');
    await expect(page.getByText(/chat with your/i)).toBeVisible({ timeout: 10_000 });

    // Click a suggestion chip
    const chip = page.getByRole('button').filter({ hasText: /spend|top|much/i }).first();
    const chipText = await chip.textContent();
    await chip.click();

    // Should see the chip text appear as user message
    await expect(page.getByText(String(chipText))).toBeVisible({ timeout: 5_000 });

    // Should get a response
    const response = page.locator('[class*="bg-muted"], .markdown-body').last();
    await expect(response).toBeVisible({ timeout: 60_000 });
  });

  // ── Negative case: no transactions → chat disabled ──

  test('without transactions, chat is disabled with warning', async ({ context, page }) => {
    skipIfNoLiveLLM();
    test.setTimeout(30_000);
    await clearAllStorage(context);
    await seedLiveLLMSettings(context);
    // Do NOT seed transactions

    await page.goto('/chat');

    // Warning banner should be visible
    await expect(page.getByText(/no statement loaded|upload.*statement first/i)).toBeVisible({ timeout: 10_000 });

    // Textarea should be disabled
    const textarea = page.locator('textarea');
    await expect(textarea).toBeDisabled();
  });
});
