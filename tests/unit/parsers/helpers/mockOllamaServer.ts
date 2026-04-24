import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

type MockStatementScenario = 'bank' | 'credit_card';

const RESPONSES = {
  bank: {
    typeDetection: JSON.stringify({
      type: 'bank',
      confidence: 0.99,
      reason: 'Bank statement detected',
      bankName: 'Acme Bank',
    }),
    summary: JSON.stringify({
      statementDate: '2025-10-31',
      statementPeriodStart: '2025-10-01',
      statementPeriodEnd: '2025-10-31',
      openingBalance: 10000,
      closingBalance: 10750,
    }),
    transactions: JSON.stringify({
      transactions: [
        {
          date: '2025-10-20',
          description: 'Salary Credit',
          amount: 1000,
          type: 'credit',
          transactionSubType: 'salary',
          merchant: 'Employer',
        },
        {
          date: '2025-10-21',
          description: 'Coffee',
          amount: 250,
          type: 'debit',
          transactionSubType: 'purchase',
          merchant: 'Coffee Shop',
        },
      ],
      _debug: { totalCount: 2, droppedTransactions: [] },
    }),
    rewards: JSON.stringify({ rewards: [] }),
  },
  credit_card: {
    typeDetection: JSON.stringify({
      type: 'credit_card',
      confidence: 0.99,
      reason: 'Credit card statement detected',
      bankName: 'Acme Bank',
    }),
    summary: JSON.stringify({
      statementDate: '2025-10-31',
      statementPeriodStart: '2025-10-01',
      statementPeriodEnd: '2025-10-31',
      paymentDueDate: '2025-11-15',
      totalDue: 2799,
      minimumDue: 280,
      previousBalance: 2000,
      paymentsReceived: 500,
      purchasesAndCharges: 1299,
      cashbackEarned: 0,
    }),
    transactions: JSON.stringify({
      transactions: [
        {
          date: '2025-10-04',
          description: 'HDFC CARD PAYMENT',
          amount: 500,
          type: 'credit',
          transactionSubType: 'bill_payment',
        },
        {
          date: '2025-10-05',
          description: 'AMAZON.IN',
          amount: 1299,
          type: 'debit',
          transactionSubType: 'purchase',
          merchant: 'AMAZON.IN',
        },
      ],
      _debug: { totalCount: 2, droppedTransactions: [] },
    }),
    rewards: JSON.stringify({ rewards: [] }),
  },
} as const;

function detectStage(prompt: string): keyof (typeof RESPONSES)['bank'] {
  if (
    prompt.includes('CREDIT CARD indicators') ||
    prompt.includes('BANK STATEMENT indicators') ||
    (prompt.includes('determine') && prompt.includes('bank statement or a credit card'))
  ) {
    return 'typeDetection';
  }

  if (prompt.includes('reward') && prompt.length < 2000) {
    return 'rewards';
  }

  if (
    prompt.includes('statementDate') &&
    (prompt.includes('totalDue') || prompt.includes('openingBalance'))
  ) {
    return 'summary';
  }

  return 'transactions';
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString('utf8');
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export async function createMockOllamaServer(scenario: MockStatementScenario) {
  const prompts: string[] = [];
  const responses = RESPONSES[scenario];

  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/api/tags') {
      json(res, 200, { models: [{ name: 'test-model' }] });
      return;
    }

    if (req.method !== 'POST' || req.url !== '/api/generate') {
      json(res, 404, { error: 'not found' });
      return;
    }

    const rawBody = await readBody(req);
    const body = JSON.parse(rawBody) as { prompt?: string };
    const prompt = body.prompt ?? '';
    prompts.push(prompt);

    const stage = detectStage(prompt);
    json(res, 200, {
      response: responses[stage],
      done: true,
      prompt_eval_count: 10,
      eval_count: 10,
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind mock Ollama server.');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    prompts,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
