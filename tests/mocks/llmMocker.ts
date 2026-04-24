import { Page, Route } from '@playwright/test';

/**
 * Pre-defined LLM response scenarios for mocking Ollama/LM Studio.
 */
export const LLM_SCENARIOS = {
  valid_type_detection: JSON.stringify({ type: 'credit_card', confidence: 0.95, reason: 'Credit card statement detected' }),

  valid_summary: JSON.stringify({
    statementDate: '2025-10-31',
    statementPeriodStart: '2025-10-01',
    statementPeriodEnd: '2025-10-31',
    paymentDueDate: '2025-11-15',
    totalDue: 5432.10,
    minimumDue: 271.60,
    creditLimit: 50000,
    availableCredit: 44567.90,
    previousBalance: 0,
    paymentsReceived: 0,
    purchasesAndCharges: 5432.10,
    cashbackEarned: 54.32,
  }),

  valid_transactions: JSON.stringify({
    transactions: [
      { date: '2025-10-05', description: 'AMAZON.IN', amount: 1299.00, type: 'debit', transactionSubType: 'purchase' },
      { date: '2025-10-12', description: 'SWIGGY', amount: 450.00, type: 'debit', transactionSubType: 'purchase' },
      { date: '2025-10-15', description: 'URBAN COMPANY', amount: 304.00, type: 'credit', transactionSubType: 'refund' }
    ],
    _debug: { totalCount: 3, droppedTransactions: [] }
  }),

  malformed_json: `{ "transactions": [ { "date": "2025-10-05", "description": "AMAZON", amount: 1299 } ] }`, // Missing quotes around amount

  wrong_schema: JSON.stringify({
    transactions: [
      { date: '2025-10-05', description: 'AMAZON.IN', amount: '1299.00', type: 'debit' } // amount is string instead of number
    ]
  }),

  partial_output: `{"transactions": [{"date": "2025-10-05", "description": "AMAZON`,

  empty_response: JSON.stringify({ transactions: [] }),

  timeout: 'TIMEOUT',
} as const;

export type LLMMockScenario = keyof typeof LLM_SCENARIOS;

/**
 * Sets up route interception for LLM endpoints.
 * Must be called BEFORE the action that triggers the LLM call.
 */
export async function mockLLMResponse(page: Page, scenario: LLMMockScenario = 'valid_transactions', options?: { statementType?: 'credit_card' | 'bank' }) {
  const responseContent = LLM_SCENARIOS[scenario];
  const capturedPrompts: string[] = [];
  const statementType = options?.statementType ?? 'bank';

  async function handleRoute(route: Route) {
    const request = route.request();
    const url = request.url();
    const isLLMEndpoint = url.includes('/api/generate') ||
                          url.includes('/api/tags') ||
                          url.includes('/v1/chat/completions') ||
                          url.includes('/v1/models');

    console.log(`[LLM Mock] Route intercepted: ${request.method()} ${url}, isLLMEndpoint: ${isLLMEndpoint}`);

    if (isLLMEndpoint) {
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
          // max_tokens may not be forwarded by the API route
          void (parsed.max_tokens);
        } catch {
          // Ignore parse errors
        }
      }

      if (responseContent === 'TIMEOUT') {
        await route.abort('timedout');
        return;
      }

      // Detect stage from prompt content and return appropriate response
      let contentToReturn = responseContent;

      // Type detection: prompt asks to determine statement type
      const isTypeDetection = (
        prompt.includes('CREDIT CARD indicators') ||
        prompt.includes('BANK STATEMENT indicators') ||
        (prompt.includes('determine') && prompt.includes('bank statement or a credit card'))
      );
      if (isTypeDetection) {
        contentToReturn = statementType === 'credit_card'
          ? LLM_SCENARIOS.valid_type_detection
          : JSON.stringify({ type: 'bank', confidence: 0.95, reason: 'Bank statement detected' });
      }

      // Rewards extraction: prompt mentions 'rewards' with small context
      else if (prompt.includes('reward') && prompt.length < 2000) {
        contentToReturn = JSON.stringify({ rewards: [] });
      }

      // Summary extraction: prompt mentions key summary fields
      else if (
        prompt.includes('statementDate') &&
        (prompt.includes('totalDue') || prompt.includes('openingBalance'))
      ) {
        // Return valid summary for CC or bank based on statementType
        if (statementType === 'credit_card') {
          contentToReturn = LLM_SCENARIOS.valid_summary;
        } else {
          // Bank summary
          contentToReturn = JSON.stringify({
            statementDate: '2025-10-31',
            statementPeriodStart: '2025-10-01',
            statementPeriodEnd: '2025-10-31',
            openingBalance: 10000,
            closingBalance: 15000,
          });
        }
      }

      // Transaction extraction: everything else with a large prompt (the main scenario response)
      // Falls through to responseContent which is set by the scenario

      if (contentToReturn === 'TIMEOUT') {
        await route.abort('timedout');
        return;
      }

      // LM Studio OpenAI compatible format
      if (request.url().includes('/v1/chat/completions') || request.url().includes('/v1/models')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            choices: [{ message: { content: contentToReturn }, finish_reason: 'stop' }]
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
    } else {
      await route.continue();
    }
  }

  await page.route('http://localhost:11434/**', handleRoute);
  await page.route('http://localhost:1234/**', handleRoute);

  return {
    getCapturedPrompts: () => [...capturedPrompts],
    getCapturedPrompt: (index: number = 0) => capturedPrompts[index] || null,
  };
}