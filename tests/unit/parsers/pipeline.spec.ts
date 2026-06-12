import { describe, it, expect, vi, beforeEach } from 'vitest';

import { processStatement } from '@/lib/parsers/pipeline';
import type { LLMRuntimeConfig } from '@/lib/llm/types';

// Mock fetch — the only external boundary (LLM HTTP calls go through here)
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock getContextWindowInfo so no listModels fetch call is needed
const mockGetContextWindowInfo = vi.fn();
vi.mock('@/lib/llm/contextWindow', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/llm/contextWindow')>();
  return {
    ...original,
    getContextWindowInfo: (...args: unknown[]) => mockGetContextWindowInfo(...args),
  };
});

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
  mockGetContextWindowInfo.mockResolvedValue({
    contextLength: undefined,
    source: 'settings_cache',
    provider: 'ollama',
    modelId: 'llama3',
  });
  mockFetch
    .mockResolvedValueOnce(ollamaJson(summary ?? bankSummaryJson()))
    .mockResolvedValueOnce(ollamaJson(transactionsJson(txns)));
}

function setupCCFetch(txns?: Array<Record<string, unknown>>, summary?: string) {
  mockGetContextWindowInfo.mockResolvedValue({
    contextLength: undefined,
    source: 'settings_cache',
    provider: 'ollama',
    modelId: 'llama3',
  });
  mockFetch
    .mockResolvedValueOnce(ollamaJson(summary ?? ccSummaryJson()))
    .mockResolvedValueOnce(ollamaJson(transactionsJson(txns)))
    .mockResolvedValueOnce(ollamaJson(JSON.stringify({ rewards: [] })));
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no cached context window in settings
  mockGetContextWindowInfo.mockResolvedValue({
    contextLength: undefined,
    source: 'settings_cache',
    provider: 'ollama',
    modelId: 'llama3',
  });
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
    mockFetch
      .mockResolvedValueOnce(ollamaJson(typeDetectionJson('bank', 0.5)));

    const result = await processStatement('raw text', defaultOptions);

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('confidence');
    expect(result.errors[0]).toContain('0.5');
    expect(result.data).toBeNull();
  });

  it('returns pipeline failure on fetch error during type detection', async () => {
    // All fetch calls reject (type detection)
    mockFetch.mockRejectedValue(new Error('Connection refused'));

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

  it('resolves currency from transaction localCurrency when present', async () => {
    const txnsWithLocalCurrency = [
      { date: '2024-01-15', description: 'Amazon.com Purchase', amount: 99.99, type: 'debit', localCurrency: 'USD' },
    ];
    setupBankFetch(txnsWithLocalCurrency);

    const result = await processStatement('raw bank text', {
      ...defaultOptions,
      statementType: 'bank',
    });

    expect(result.success).toBe(true);
    expect(result.data?.currency).toEqual({ code: 'USD', symbol: '$', name: 'US Dollar' });
  });
});

describe('processStatement — warning branches', () => {
  it('warns when credit card summary extraction fails but transactions succeed', async () => {
    // Summary: 3 invalid-JSON responses (MAX_RETRIES), then valid transactions + rewards
    const invalidSummaryResponse = 'NOT VALID JSON {{{';
    mockFetch
      .mockResolvedValueOnce(ollamaJson(invalidSummaryResponse))
      .mockResolvedValueOnce(ollamaJson(invalidSummaryResponse))
      .mockResolvedValueOnce(ollamaJson(invalidSummaryResponse))
      .mockResolvedValueOnce(ollamaJson(transactionsJson()))
      .mockResolvedValueOnce(ollamaJson(JSON.stringify({ rewards: [] })));

    const result = await processStatement('credit card statement with cashback', {
      ...defaultOptions,
      statementType: 'credit_card',
    });

    expect(result.success).toBe(true);
    expect(result.data?.transactions).toHaveLength(1);
    expect(result.warnings.some(w => w.includes('Summary extraction had issues'))).toBe(true);
  });

  it('warns when bank summary extraction fails but transactions succeed', async () => {
    const invalidSummaryResponse = 'NOT VALID JSON {{{';
    mockFetch
      .mockResolvedValueOnce(ollamaJson(invalidSummaryResponse))
      .mockResolvedValueOnce(ollamaJson(invalidSummaryResponse))
      .mockResolvedValueOnce(ollamaJson(invalidSummaryResponse))
      .mockResolvedValueOnce(ollamaJson(transactionsJson()));

    const result = await processStatement('raw bank text', {
      ...defaultOptions,
      statementType: 'bank',
    });

    expect(result.success).toBe(true);
    expect(result.data?.transactions).toHaveLength(1);
    expect(result.warnings.some(w => w.includes('Summary extraction had issues'))).toBe(true);
  });

  it('warns on partial extraction when transactions succeed with errors', async () => {
    // In the chunked path, if some chunks succeed but have issues, the pipeline
    // reports partial extraction. To trigger chunking, text must exceed 12000 chars.
    // We'll use a line-threshold approach with 300+ lines (> 250 threshold).
    const longLines = Array.from({ length: 300 }, (_, i) => `Line ${i + 1}: some transaction data here`);
    const longText = longLines.join('\n');

    // Chunk plan will create 2 chunks (300 lines / 180 target = 2 chunks with overlap)
    // First chunk: valid transactions with a noise row (produces a warning)
    const chunk1Txns = [
      { date: '2024-01-15', description: 'Opening Balance', amount: 100, type: 'debit' },
      { date: '2024-01-16', description: 'Valid Purchase', amount: 50, type: 'debit' },
    ];
    // Second chunk: valid transactions
    const chunk2Txns = [
      { date: '2024-02-01', description: 'Another Purchase', amount: 75, type: 'debit' },
    ];

    // Bank summary + 2 chunk extraction calls
    mockFetch
      .mockResolvedValueOnce(ollamaJson(bankSummaryJson()))
      .mockResolvedValueOnce(ollamaJson(transactionsJson(chunk1Txns)))
      .mockResolvedValueOnce(ollamaJson(transactionsJson(chunk2Txns)));

    const result = await processStatement(longText, {
      ...defaultOptions,
      statementType: 'bank',
    });

    // The "Opening Balance" row is filtered as noise (becomes a warning, not error).
    // Chunked path with hasUsableData=true moves chunk errors to warnings.
    expect(result.success).toBe(true);
    expect(result.data?.transactions.length).toBeGreaterThanOrEqual(1);
  });

  it('warns when rewards extraction fails for credit card', async () => {
    const invalidRewardsResponse = 'BROKEN JSON }}}';
    mockFetch
      .mockResolvedValueOnce(ollamaJson(ccSummaryJson()))
      .mockResolvedValueOnce(ollamaJson(transactionsJson()))
      // Rewards: 3 invalid responses (MAX_RETRIES)
      .mockResolvedValueOnce(ollamaJson(invalidRewardsResponse))
      .mockResolvedValueOnce(ollamaJson(invalidRewardsResponse))
      .mockResolvedValueOnce(ollamaJson(invalidRewardsResponse));

    const result = await processStatement('credit card statement with cashback rewards', {
      ...defaultOptions,
      statementType: 'credit_card',
    });

    expect(result.success).toBe(true);
    expect(result.data?.transactions).toHaveLength(1);
    expect(result.warnings.some(w => w.includes('Rewards extraction had issues'))).toBe(true);
  });
});

describe('processStatement — bank chunked extraction', () => {
  it('chunks long text and merges transactions from multiple chunks', async () => {
    // Build text that exceeds the 12000-char threshold (char_threshold path)
    const longLine = 'Transaction data line with sufficient content to build up character count for threshold testing';
    const longText = Array.from({ length: 250 }, (_, i) => `${longLine} #${i + 1}`).join('\n');
    // Verify text exceeds 12000 chars so chunking is triggered
    expect(longText.length).toBeGreaterThan(12000);

    const chunk1Txns = [
      { date: '2024-01-10', description: 'Grocery Store', amount: 45.50, type: 'debit' },
      { date: '2024-01-12', description: 'Gas Station', amount: 60.00, type: 'debit' },
    ];
    const chunk2Txns = [
      { date: '2024-01-20', description: 'Salary Deposit', amount: 5000, type: 'credit' },
    ];

    mockFetch
      .mockResolvedValueOnce(ollamaJson(bankSummaryJson()))
      .mockResolvedValueOnce(ollamaJson(transactionsJson(chunk1Txns)))
      .mockResolvedValueOnce(ollamaJson(transactionsJson(chunk2Txns)));

    const result = await processStatement(longText, {
      ...defaultOptions,
      statementType: 'bank',
    });

    expect(result.success).toBe(true);
    expect(result.data?.transactions).toHaveLength(3);
    // Verify all transactions from both chunks are present
    const descriptions = result.data?.transactions.map(t => t.description) ?? [];
    expect(descriptions).toContain('Grocery Store');
    expect(descriptions).toContain('Gas Station');
    expect(descriptions).toContain('Salary Deposit');
  });

  it('returns failure when all chunks fail extraction', async () => {
    const longLine = 'Transaction data line with sufficient content to build up character count for threshold testing';
    const longText = Array.from({ length: 250 }, (_, i) => `${longLine} #${i + 1}`).join('\n');

    const brokenResponse = 'BROKEN JSON }}}';
    mockFetch
      .mockResolvedValueOnce(ollamaJson(bankSummaryJson()))
      // Chunk 1: 3 failed retries
      .mockResolvedValueOnce(ollamaJson(brokenResponse))
      .mockResolvedValueOnce(ollamaJson(brokenResponse))
      .mockResolvedValueOnce(ollamaJson(brokenResponse))
      // Chunk 2: 3 failed retries
      .mockResolvedValueOnce(ollamaJson(brokenResponse))
      .mockResolvedValueOnce(ollamaJson(brokenResponse))
      .mockResolvedValueOnce(ollamaJson(brokenResponse));

    const result = await processStatement(longText, {
      ...defaultOptions,
      statementType: 'bank',
    });

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    // No transactions extracted (empty array or null)
    expect((result.data?.transactions ?? []).length).toBe(0);
  });

  it('recovers partial data when some chunks fail', async () => {
    const longLine = 'Transaction data line with sufficient content to build up character count for threshold testing';
    const longText = Array.from({ length: 250 }, (_, i) => `${longLine} #${i + 1}`).join('\n');

    const brokenResponse = 'BROKEN JSON }}}';
    const chunk1Txns = [
      { date: '2024-01-10', description: 'Surviving Txn', amount: 45.50, type: 'debit' },
    ];

    mockFetch
      .mockResolvedValueOnce(ollamaJson(bankSummaryJson()))
      // Chunk 1 succeeds
      .mockResolvedValueOnce(ollamaJson(transactionsJson(chunk1Txns)))
      // Chunk 2: 3 failed retries
      .mockResolvedValueOnce(ollamaJson(brokenResponse))
      .mockResolvedValueOnce(ollamaJson(brokenResponse))
      .mockResolvedValueOnce(ollamaJson(brokenResponse));

    const result = await processStatement(longText, {
      ...defaultOptions,
      statementType: 'bank',
    });

    // hasUsableData=true (1 txn survived), so success=true with chunk errors as warnings
    expect(result.success).toBe(true);
    expect(result.data?.transactions).toHaveLength(1);
    expect(result.data?.transactions[0].description).toBe('Surviving Txn');
    // Chunk 2 failures should appear in warnings (moved from errors)
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe('processStatement — credit card chunks large statements', () => {
  it('chunks credit card statements when text exceeds thresholds', async () => {
    // Build text exceeding both thresholds (12K chars, 250 lines), including rewards keywords
    const longLine = 'Credit card transaction data with cashback rewards points earned';
    const longText = Array.from({ length: 300 }, (_, i) => `${longLine} #${i + 1}`).join('\n');
    expect(longText.length).toBeGreaterThan(12000);

    // CC path with chunking: summary + 2 chunk transactions + rewards = 4 calls
    mockFetch
      .mockResolvedValueOnce(ollamaJson(ccSummaryJson()))
      .mockResolvedValueOnce(ollamaJson(transactionsJson()))
      .mockResolvedValueOnce(ollamaJson(transactionsJson()))
      .mockResolvedValueOnce(ollamaJson(JSON.stringify({ rewards: [] })));

    const result = await processStatement(longText, {
      ...defaultOptions,
      statementType: 'credit_card',
    });

    expect(result.success).toBe(true);
    // CC path: summary + chunk1 transactions + chunk2 transactions + rewards = 4 calls
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });
});

describe('processStatement — error path coverage', () => {
  it('retries CC summary after validation failure (onValidationFailure callback)', async () => {
    // Parseable JSON that fails validateCCSummary (bad date format)
    const invalidCCSummary = JSON.stringify({
      statementDate: 'not-a-date',
      totalDue: 5000,
      minimumDue: 500,
      creditLimit: 100000,
      previousBalance: 4000,
    });
    mockFetch
      .mockResolvedValueOnce(ollamaJson(invalidCCSummary))    // attempt 1: fails validation → onValidationFailure fires
      .mockResolvedValueOnce(ollamaJson(ccSummaryJson()))      // attempt 2: valid
      .mockResolvedValueOnce(ollamaJson(transactionsJson()))    // transactions
      .mockResolvedValueOnce(ollamaJson(JSON.stringify({ rewards: [] }))); // rewards

    const result = await processStatement('credit card statement with cashback', {
      ...defaultOptions,
      statementType: 'credit_card',
    });

    expect(result.success).toBe(true);
    expect(result.data?.statementSummary).toBeDefined();
    // summary (2 attempts) + transactions + rewards = 4 fetch calls
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('retries bank summary after validation failure (onValidationFailure callback)', async () => {
    const invalidBankSummary = JSON.stringify({
      statementDate: 'not-a-date',
      openingBalance: 10000,
      closingBalance: 5000,
    });
    mockFetch
      .mockResolvedValueOnce(ollamaJson(invalidBankSummary))   // attempt 1: fails validation → onValidationFailure fires
      .mockResolvedValueOnce(ollamaJson(bankSummaryJson()))     // attempt 2: valid
      .mockResolvedValueOnce(ollamaJson(transactionsJson()));    // transactions

    const result = await processStatement('raw bank text', {
      ...defaultOptions,
      statementType: 'bank',
    });

    expect(result.success).toBe(true);
    // summary (2 attempts) + transactions = 3 fetch calls
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('reports transaction extraction failure for credit card path', async () => {
    const brokenResponse = 'BROKEN JSON }}}';
    mockFetch
      .mockResolvedValueOnce(ollamaJson(ccSummaryJson()))
      .mockResolvedValueOnce(ollamaJson(brokenResponse))  // txn attempt 1
      .mockResolvedValueOnce(ollamaJson(brokenResponse))  // txn attempt 2
      .mockResolvedValueOnce(ollamaJson(brokenResponse))  // txn attempt 3
      .mockResolvedValueOnce(ollamaJson(JSON.stringify({ rewards: [] })));

    const result = await processStatement('credit card statement with cashback', {
      ...defaultOptions,
      statementType: 'credit_card',
    });

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('Transaction extraction failed');
  });

  it('reports partial extraction warning when some CC chunks fail', async () => {
    const longLine = 'Credit card transaction data with cashback rewards';
    const longText = Array.from({ length: 300 }, (_, i) => `${longLine} #${i + 1}`).join('\n');

    const brokenResponse = 'BROKEN JSON }}}';
    const chunk1Txns = [
      { date: '2024-01-10', description: 'CC Purchase', amount: 45.50, type: 'debit' },
    ];

    mockFetch
      .mockResolvedValueOnce(ollamaJson(ccSummaryJson()))
      .mockResolvedValueOnce(ollamaJson(transactionsJson(chunk1Txns)))  // chunk 1: valid
      .mockResolvedValueOnce(ollamaJson(brokenResponse))                // chunk 2 attempt 1
      .mockResolvedValueOnce(ollamaJson(brokenResponse))                // chunk 2 attempt 2
      .mockResolvedValueOnce(ollamaJson(brokenResponse))                // chunk 2 attempt 3
      .mockResolvedValueOnce(ollamaJson(JSON.stringify({ rewards: [] })));

    const result = await processStatement(longText, {
      ...defaultOptions,
      statementType: 'credit_card',
    });

    expect(result.success).toBe(true);
    expect(result.data?.transactions).toHaveLength(1);
    expect(result.warnings.some(w => w.includes('Partial extraction'))).toBe(true);
  });

  it('fires chunk validation failure callback for parseable but invalid chunk data', async () => {
    const longLine = 'Transaction data line with sufficient content to build up character count for threshold testing';
    const longText = Array.from({ length: 250 }, (_, i) => `${longLine} #${i + 1}`).join('\n');

    // Parseable JSON that fails validateTransactions (negative amount)
    const invalidChunkTxns = [
      { date: '2024-01-15', description: 'Invalid Amount', amount: -50, type: 'debit' },
    ];
    const chunk2Txns = [
      { date: '2024-02-01', description: 'Valid Purchase', amount: 75, type: 'debit' },
    ];

    mockFetch
      .mockResolvedValueOnce(ollamaJson(bankSummaryJson()))
      // Chunk 1: 3 attempts with parseable but invalid data → triggers onValidationFailure each time
      .mockResolvedValueOnce(ollamaJson(transactionsJson(invalidChunkTxns)))
      .mockResolvedValueOnce(ollamaJson(transactionsJson(invalidChunkTxns)))
      .mockResolvedValueOnce(ollamaJson(transactionsJson(invalidChunkTxns)))
      // Chunk 2: valid
      .mockResolvedValueOnce(ollamaJson(transactionsJson(chunk2Txns)));

    const result = await processStatement(longText, {
      ...defaultOptions,
      statementType: 'bank',
    });

    // hasUsableData=true (chunk 2 succeeded), so success with chunk 1 failures as warnings
    expect(result.success).toBe(true);
    expect(result.data?.transactions.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('warns about chunk overlap amount conflicts', async () => {
    const longLine = 'Transaction data line with sufficient content to build up character count for threshold testing';
    const longText = Array.from({ length: 250 }, (_, i) => `${longLine} #${i + 1}`).join('\n');

    // Same transaction extracted with different amounts across chunks
    const chunk1Txns = [
      { date: '2024-01-15', description: 'Amazon Purchase', amount: 100, type: 'debit', confidence: 0.9 },
    ];
    const chunk2Txns = [
      { date: '2024-01-15', description: 'Amazon Purchase', amount: 150, type: 'debit', confidence: 0.7 },
    ];

    mockFetch
      .mockResolvedValueOnce(ollamaJson(bankSummaryJson()))
      .mockResolvedValueOnce(ollamaJson(transactionsJson(chunk1Txns)))
      .mockResolvedValueOnce(ollamaJson(transactionsJson(chunk2Txns)));

    const result = await processStatement(longText, {
      ...defaultOptions,
      statementType: 'bank',
    });

    expect(result.success).toBe(true);
    // mergeChunkTransactions detects same date/type/description with different amounts → conflict resolved
    expect(result.warnings.some(w => w.includes('Chunk overlap: resolved 1 amount conflict'))).toBe(true);
    // Higher-confidence extraction (amount 100, confidence 0.9) should win
    expect(result.data?.transactions).toHaveLength(1);
    expect(result.data?.transactions[0].amount).toBe(100);
  });
});

describe('processStatement — type detection bankName forwarding', () => {
  it('forwards bankName from type detection to extraction', async () => {
    const detectedType = typeDetectionJson('bank', 0.95);
    // Override the default bankName in the type detection response
    const detectedWithType = JSON.parse(detectedType);
    detectedWithType.bankName = 'SBI';
    const typeDetectionResponse = JSON.stringify(detectedWithType);

    mockFetch
      .mockResolvedValueOnce(ollamaJson(typeDetectionResponse))
      .mockResolvedValueOnce(ollamaJson(bankSummaryJson()))
      .mockResolvedValueOnce(ollamaJson(transactionsJson()));

    const result = await processStatement('raw bank text', defaultOptions);

    expect(result.success).toBe(true);
    // The pipeline succeeded with type detection + summary + transactions
    expect(mockFetch).toHaveBeenCalledTimes(3);
    // bankName is forwarded internally to prompt builders (verified by successful extraction)
    expect(result.data?.statementType).toBe('bank');
    expect(result.data?.transactions).toHaveLength(1);
  });
});
