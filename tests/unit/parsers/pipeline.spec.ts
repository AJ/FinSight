import { describe, it, expect, vi, beforeEach } from 'vitest';

import { processStatement } from '@/lib/parsers/pipeline';
import type { LLMRuntimeConfig } from '@/lib/llm/types';

// Mock fetch — the only external boundary (LLM HTTP calls go through here)
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const baseConfig: LLMRuntimeConfig = {
  provider: 'ollama',
  baseUrl: 'http://localhost:11434',
  model: 'llama3',
};

const defaultCurrency = { code: 'INR', symbol: '₹', name: 'Indian Rupee' };

const defaultOptions = {
  format: 'pdf' as const,
  defaultCurrency,
  fileName: 'test.pdf',
  llmConfig: baseConfig,
};

// ── Mock Response Helpers ──────────────────────────────────────────────────────

function ollamaJson(llmOutput: string) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({
      response: llmOutput,
      prompt_eval_count: 10,
      eval_count: 20,
    }),
    text: () => Promise.resolve(JSON.stringify({ response: llmOutput })),
  });
}

// ── LLM Payload Builders ───────────────────────────────────────────────────────

function bankSummaryJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    statementDate: '2024-01-15',
    openingBalance: 10000,
    closingBalance: 5000,
    ...overrides,
  });
}

function ccSummaryJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    statementDate: '2024-01-15',
    totalDue: 5000,
    minimumDue: 500,
    creditLimit: 100000,
    previousBalance: 4000,
    purchasesAndCharges: 2000,
    paymentsReceived: 1000,
    ...overrides,
  });
}

function transactionsJson(txns?: Array<Record<string, unknown>>) {
  const transactions = txns ?? [
    { date: '2024-01-15', description: 'Amazon Purchase', amount: 99.99, type: 'debit' },
  ];
  return JSON.stringify({ transactions });
}

function typeDetectionJson(type: 'bank' | 'credit_card', confidence = 0.95) {
  return JSON.stringify({
    type,
    confidence,
    reason: 'Detected from content analysis',
    bankName: 'HDFC',
  });
}

// ── Scenario Setup Helpers ─────────────────────────────────────────────────────

function setupBankFetch(txns?: Array<Record<string, unknown>>, summary?: string) {
  mockFetch
    .mockResolvedValueOnce(ollamaJson(summary ?? bankSummaryJson()))
    .mockResolvedValueOnce(ollamaJson(transactionsJson(txns)));
}

function setupCCFetch(txns?: Array<Record<string, unknown>>, summary?: string) {
  mockFetch
    .mockResolvedValueOnce(ollamaJson(summary ?? ccSummaryJson()))
    .mockResolvedValueOnce(ollamaJson(transactionsJson(txns)))
    .mockResolvedValueOnce(ollamaJson(JSON.stringify({ rewards: [] })));
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('processStatement — routing', () => {
  it('uses explicit statementType, skipping type detection', async () => {
    setupBankFetch();

    const result = await processStatement('raw bank statement text', {
      ...defaultOptions,
      statementType: 'bank',
    });

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2); // summary + transactions, no type detection
  });

  it('calls type detection when no explicit type provided', async () => {
    mockFetch
      .mockResolvedValueOnce(ollamaJson(typeDetectionJson('bank', 0.95)))
      .mockResolvedValueOnce(ollamaJson(bankSummaryJson()))
      .mockResolvedValueOnce(ollamaJson(transactionsJson()));

    const result = await processStatement('raw bank text', defaultOptions);

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(3); // type detection + summary + transactions
  });

  it('returns failure when type detection confidence is below threshold', async () => {
    mockFetch.mockResolvedValueOnce(ollamaJson(typeDetectionJson('bank', 0.5)));

    const result = await processStatement('raw text', defaultOptions);

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('confidence');
    expect(result.errors[0]).toContain('0.5');
    expect(result.data).toBeNull();
  });

  it('returns pipeline failure on fetch error during type detection', async () => {
    // Generic Error is non-retryable in the client's error classifier, so no retry delay
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const result = await processStatement('raw text', defaultOptions);

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('Pipeline failed');
  });
});

describe('processStatement — credit card path', () => {
  it('extracts summary, transactions, and rewards for credit card', async () => {
    // Text must include "cashback" or "reward" to trigger rewards prompt
    setupCCFetch();

    const result = await processStatement('credit card statement with cashback rewards', {
      ...defaultOptions,
      statementType: 'credit_card',
    });

    expect(result.success).toBe(true);
    expect(result.data?.transactions).toHaveLength(1);
    expect(result.data?.statementType).toBe('credit_card');
    expect(result.data?.statementSummary).toBeDefined();
    expect(mockFetch).toHaveBeenCalledTimes(3); // summary + transactions + rewards
  });

  it('does not call rewards prompt for bank type', async () => {
    setupBankFetch();

    await processStatement('raw bank text', {
      ...defaultOptions,
      statementType: 'bank',
    });

    expect(mockFetch).toHaveBeenCalledTimes(2); // summary + transactions only
  });

  it('skips rewards extraction when text has no rewards keywords', async () => {
    mockFetch
      .mockResolvedValueOnce(ollamaJson(ccSummaryJson()))
      .mockResolvedValueOnce(ollamaJson(transactionsJson()));
    // No third mock — buildRewardsPrompt returns '' when text lacks reward/cashback/points

    const result = await processStatement('credit card statement with charges and payments', {
      ...defaultOptions,
      statementType: 'credit_card',
    });

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2); // summary + transactions, no rewards
  });

  it('strips reasoning field from canonical transactions', async () => {
    const txnsWithReasoning = [
      { date: '2024-01-15', description: 'CC PAYMENT VIA NEFT', amount: 5000, type: 'credit', transactionSubType: 'bill_payment', reasoning: 'NEFT payment detected' },
      { date: '2024-01-16', description: 'AMAZON.IN', amount: 1299, type: 'debit', transactionSubType: 'purchase', reasoning: 'Merchant purchase' },
    ];
    setupCCFetch(txnsWithReasoning);

    const result = await processStatement('credit card statement with cashback', {
      ...defaultOptions,
      statementType: 'credit_card',
    });

    expect(result.success).toBe(true);
    expect(result.data?.transactions).toHaveLength(2);
    for (const txn of result.data?.transactions ?? []) {
      expect(txn).not.toHaveProperty('reasoning');
    }
  });
});

describe('processStatement — verification inputs', () => {
  it('builds bank verification inputs with opening/closing balance', async () => {
    setupBankFetch();

    const result = await processStatement('raw bank text', {
      ...defaultOptions,
      statementType: 'bank',
    });

    expect(result.success).toBe(true);
    expect(result.data?.verificationInputs).toBeDefined();
    expect(result.data?.verificationInputs?.kind).toBe('bank');
    const vi = result.data?.verificationInputs as { meta: Record<string, unknown>; summary: unknown };
    expect(vi.meta.openingBalance).toBe(10000);
    expect(vi.meta.closingBalance).toBe(5000);
    expect(vi.meta.currency).toBe('INR');
    expect(vi.summary).toBeDefined();
  });

  it('builds credit card verification inputs with totalDue and payments', async () => {
    setupCCFetch();

    const result = await processStatement('credit card statement with cashback', {
      ...defaultOptions,
      statementType: 'credit_card',
    });

    expect(result.success).toBe(true);
    expect(result.data?.verificationInputs?.kind).toBe('credit_card');
    const vi = result.data?.verificationInputs as { meta: Record<string, unknown>; summary: unknown };
    expect(vi.meta.totalDue).toBe(5000);
    expect(vi.meta.previousBalance).toBe(4000);
    expect(vi.meta.paymentsReceived).toBe(1000);
  });

  it('returns undefined verification inputs when summary lacks openingBalance', async () => {
    const minimalSummary = JSON.stringify({ statementDate: '2024-01-15' });
    mockFetch
      .mockResolvedValueOnce(ollamaJson(minimalSummary))
      .mockResolvedValueOnce(ollamaJson(transactionsJson()));

    const result = await processStatement('raw bank text', {
      ...defaultOptions,
      statementType: 'bank',
    });

    expect(result.success).toBe(true);
    expect(result.data?.verificationInputs).toBeUndefined();
  });
});

describe('processStatement — extraction bundle', () => {
  it('fails pipeline when transactions are invalid', async () => {
    const invalidTxns = [
      { date: '2024-01-15', description: 'Bad Txn', amount: -50, type: 'debit' },
    ];
    // Summary succeeds, then transactions fail validation 3 times (retry engine retries)
    mockFetch
      .mockResolvedValueOnce(ollamaJson(bankSummaryJson()))
      .mockResolvedValueOnce(ollamaJson(transactionsJson(invalidTxns)))
      .mockResolvedValueOnce(ollamaJson(transactionsJson(invalidTxns)))
      .mockResolvedValueOnce(ollamaJson(transactionsJson(invalidTxns)));

    const result = await processStatement('raw bank text', {
      ...defaultOptions,
      statementType: 'bank',
    });

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('Pipeline failed');
    expect(result.data).toBeNull();
  });

  it('carries duplicate warnings from merge engine', async () => {
    const duplicateTxns = [
      { date: '2024-01-15', description: 'Amazon Purchase India', amount: 99.99, type: 'debit' },
      { date: '2024-01-15', description: 'Amazon Purchase India', amount: 99.99, type: 'debit' },
    ];
    setupBankFetch(duplicateTxns);

    const result = await processStatement('raw bank text', {
      ...defaultOptions,
      statementType: 'bank',
    });

    expect(result.success).toBe(true);
    expect(result.data?.warnings.some(w => w.includes('potential duplicate'))).toBe(true);
  });

  it('resolves currency from default when transactions have no localCurrency', async () => {
    setupBankFetch();

    const result = await processStatement('raw bank text', {
      ...defaultOptions,
      statementType: 'bank',
    });

    expect(result.success).toBe(true);
    expect(result.data?.currency).toEqual(defaultCurrency);
  });
});
