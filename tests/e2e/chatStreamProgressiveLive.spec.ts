import { test, expect } from '@playwright/test';
import {
  skipIfNoLiveLLM,
  seedLiveLLMSettings,
  seedTransactions,
} from '@tests/e2e/helpers/liveTestHelpers';
import { clearAllStorage } from '@tests/utils/storageHelpers';
import { LLM_TEST_TIMEOUT } from '@tests/e2e/helpers/liveTimeouts';

// Same sample data as chatWithDataLive — gives the chat real transactions to reason about.
const SAMPLE_TRANSACTIONS = [
  { id: 'test-1', date: '2025-08-01', description: 'AMAZON INDIA', amount: 1299, type: 'debit', category: 'shopping', localCurrency: { code: 'INR', symbol: '₹' } },
  { id: 'test-2', date: '2025-08-05', description: 'SWIGGY', amount: 450, type: 'debit', category: 'dining', localCurrency: { code: 'INR', symbol: '₹' } },
  { id: 'test-3', date: '2025-08-10', description: 'SALARY CREDIT', amount: 75000, type: 'credit', category: 'income', localCurrency: { code: 'INR', symbol: '₹' } },
];

/**
 * Verifies chat streaming at the NETWORK layer, not the DOM.
 *
 * The sibling test in chatWithDataLive.spec.ts ("streaming delivers tokens progressively")
 * samples the on-screen answer length and requires it to grow between reads. That is racy:
 * on a fast local model a short answer can fully arrive within one read window, so growth
 * isn't observable even though streaming works — and screen-reading cannot distinguish
 * "streamed fast" from "not streamed at all".
 *
 * This test instead captures the actual streaming response from the LLM and counts its chunks.
 * LM Studio (OpenAI-compatible) streams as SSE: one `data:` line per token batch, terminated
 * by `data: [DONE]`. A genuinely streamed response has MANY `data:` lines; a non-streamed
 * response has one. The chunk count is fixed in the response itself — no timing race, no
 * fragile screen selector.
 *
 * Provider note: this counts SSE `data:` lines (LM Studio / OpenAI format at
 * /v1/chat/completions). The Ollama adapter uses NDJSON at /api/chat — if the suite is ever
 * run against Ollama, extend the chunk counting to parse NDJSON lines instead.
 */
test.describe('Chat streaming — network-level chunk count', () => {
  test('streaming response arrives in multiple SSE chunks', async ({ context, page }) => {
    skipIfNoLiveLLM();
    test.setTimeout(LLM_TEST_TIMEOUT);
    await clearAllStorage(context);
    await seedLiveLLMSettings(context);
    await seedTransactions(context, SAMPLE_TRANSACTIONS);

    await page.goto('/chat');
    await expect(page.getByText(/chat with your/i)).toBeVisible({ timeout: 10_000 });

    // Capture the chat-completions response. Set up BEFORE sending — the request fires on Enter.
    const chatResponsePromise = page.waitForResponse(
      (resp) => resp.url().includes('/v1/chat/completions') && resp.request().method() === 'POST',
      { timeout: 60_000 },
    );

    const textarea = page.locator('textarea');
    await textarea.fill('What are my top expenses?');
    await textarea.press('Enter');

    const chatResponse = await chatResponsePromise;
    // .body() resolves once the stream completes — this is the full SSE payload.
    const body = (await chatResponse.body()).toString();

    // Count streamed chunks: SSE `data:` lines, excluding the terminal [DONE] sentinel.
    const chunks = body
      .split('\n')
      .filter((line) => line.startsWith('data:') && !line.includes('[DONE]'))
      .length;

    console.log(`[chat-stream-net] SSE chunks: ${chunks}`);
    // Progressive streaming delivers the answer across many chunks. A single chunk would mean
    // the whole answer arrived at once (no streaming). Require more than one.
    expect(
      chunks,
      `Expected multiple SSE chunks for progressive streaming, got ${chunks}. Body head: ${body.slice(0, 120)}`,
    ).toBeGreaterThan(1);
  });
});
