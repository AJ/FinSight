import { Page, Route } from '@playwright/test';
import { LLM_SCENARIOS } from './llmMocker';

/**
 * Mock LLM responses for chunked extraction with selective chunk failures.
 *
 * Extends the base mockLLMResponse pattern with call-counting for
 * transaction extraction calls. This simulates the pipeline's multi-chunk
 * extraction where each chunk gets its own LLM call.
 *
 * @param failChunks - Array of 0-based chunk indices that should fail
 *   (return malformed JSON). All other chunks return valid transactions.
 */
export async function mockChunkedLLMResponse(
  page: Page,
  options: {
    failChunks: number[];
    validTransactions?: Array<Record<string, unknown>>;
  },
) {
  const { failChunks, validTransactions } = options;
  const txCallIndex = { count: 0 };
  const capturedPrompts: string[] = [];

  async function handleRoute(route: Route) {
    const request = route.request();
    const url = request.url();
    const isLLMEndpoint = url.includes('/api/generate') ||
                          url.includes('/api/tags') ||
                          url.includes('/v1/chat/completions') ||
                          url.includes('/v1/models');

    if (!isLLMEndpoint) {
      await route.continue();
      return;
    }

    let prompt = '';
    if (request.method() === 'POST') {
      try {
        const postBody = request.postData() || '';
        const parsed = JSON.parse(postBody);
        const messages = parsed.messages;
        if (Array.isArray(messages) && messages.length > 0) {
          prompt = messages.map((m: Record<string, unknown>) => m.content as string).join('\n');
        } else if (parsed.prompt) {
          prompt = parsed.prompt;
        }
        capturedPrompts.push(prompt);
      } catch {
        // Ignore parse errors
      }
    }

    let contentToReturn: string;

    // Type detection
    if (
      prompt.includes('CREDIT CARD indicators') ||
      prompt.includes('BANK STATEMENT indicators') ||
      (prompt.includes('determine') && prompt.includes('bank statement or a credit card'))
    ) {
      contentToReturn = JSON.stringify({ type: 'bank', confidence: 0.95, reason: 'Bank statement detected' });
    }
    // Summary extraction
    else if (prompt.includes('statementDate') && (prompt.includes('totalDue') || prompt.includes('openingBalance'))) {
      contentToReturn = JSON.stringify({
        statementDate: '2025-10-31',
        statementPeriodStart: '2025-10-01',
        statementPeriodEnd: '2025-10-31',
        openingBalance: 10000,
        closingBalance: 15000,
      });
    }
    // Transaction extraction — this is the chunked call
    else if (prompt.includes('transaction') || prompt.length > 500) {
      const chunkIdx = txCallIndex.count;
      txCallIndex.count++;

      if (failChunks.includes(chunkIdx)) {
        // Return malformed JSON — will fail all 3 retries for this chunk
        contentToReturn = LLM_SCENARIOS.malformed_json;
      } else {
        const txns = validTransactions ?? [
          { date: '2025-10-05', description: 'AMAZON.IN', amount: 1299.00, type: 'debit', transactionSubType: 'purchase' },
          { date: '2025-10-12', description: 'SWIGGY', amount: 450.00, type: 'debit', transactionSubType: 'purchase' },
        ];
        contentToReturn = JSON.stringify({
          transactions: txns,
          _debug: { totalCount: txns.length, droppedTransactions: [] },
        });
      }
    }
    // Fallback
    else {
      const txns = validTransactions ?? [
        { date: '2025-10-05', description: 'AMAZON.IN', amount: 1299.00, type: 'debit', transactionSubType: 'purchase' },
      ];
      contentToReturn = JSON.stringify({
        transactions: txns,
        _debug: { totalCount: txns.length, droppedTransactions: [] },
      });
    }

    // LM Studio format
    if (url.includes('/v1/chat/completions') || url.includes('/v1/models')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          choices: [{ message: { content: contentToReturn }, finish_reason: 'stop' }],
        }),
      });
    } else {
      // Ollama format
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ response: contentToReturn, done: true }),
      });
    }
  }

  await page.route('http://localhost:11434/**', handleRoute);
  await page.route('http://localhost:1234/**', handleRoute);

  return {
    getCapturedPrompts: () => [...capturedPrompts],
    getTransactionCallCount: () => txCallIndex.count,
  };
}
