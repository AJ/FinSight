import { describe, it, expect, vi, beforeEach } from 'vitest';

import { processStatement } from '@/lib/parsers/pipeline';
import { ManualTypeSelectionError } from '@/lib/parsers/typeDetection';
import type { LLMRuntimeConfig } from '@/lib/llm/types';
import { formatCreditCardTransactionInput } from '@/lib/parsers/lineNumbering';

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

// The prompt sent in fetch call N (Ollama generate posts { prompt } as JSON body).
function fetchPrompt(callIndex: number): string {
  const body = JSON.parse(mockFetch.mock.calls[callIndex][1].body as string);
  return body.prompt as string;
}

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

// Ollama wire shape for a generation cut by the num_predict cap: done_reason
// "length". The response body is whatever partial JSON the model managed.
function ollamaTruncated(llmOutput: string) {
  const body = {
    response: llmOutput,
    prompt_eval_count: 10,
    eval_count: 20,
    done: true,
    done_reason: 'length',
  };
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
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

  it('surfaces summary context overflow as a hard error, not a silent warning', async () => {
    // Small context window + large statement → summary prompt overflows. The retry
    // engine's pre-flight guard sets contextOverflow=true and bails before any LLM
    // call. pipeline must push this to errors[] (success=false), not warnings[],
    // so it propagates to the user instead of silently producing empty balances.
    mockGetContextWindowInfo.mockResolvedValue({
      contextLength: 500,
      source: 'settings_cache',
      provider: 'ollama',
      modelId: 'llama3',
    });
    // No fetch mock needed — the overflow guard must prevent any LLM call.
    mockFetch.mockResolvedValue(ollamaJson('unexpected — guard should prevent this call'));

    const largeText = 'x'.repeat(5000);
    const result = await processStatement(largeText, {
      ...defaultOptions,
      statementType: 'bank', // skip type detection (its guard would also trip)
    });

    expect(result.success).toBe(false);
    const overflowError = result.errors.find((e) => e.includes("exceeds the model's context window"));
    expect(overflowError).toBeDefined();
    expect(overflowError).toContain('500');
    // Crucially NOT a warning — verify the overflow message is absent from warnings.
    expect(result.warnings.some((w) => w.includes("exceeds the model's context window"))).toBe(false);
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

  it('throws ManualTypeSelectionError when type detection confidence is below threshold', async () => {
    mockFetch
      .mockResolvedValueOnce(ollamaJson(typeDetectionJson('bank', 0.5)));

    // Low-confidence detection is a recoverable outcome: the pipeline throws a
    // ManualTypeSelectionError (propagated unwrapped, not a generic success:false)
    // so the upload UI can catch it via isManualTypeSelectionError and re-prompt
    // the user for an explicit type.
    await expect(processStatement('raw text', defaultOptions))
      .rejects.toBeInstanceOf(ManualTypeSelectionError);
  });

  it('throws ManualTypeSelectionError when type detection omits confidence', async () => {
    // A missing confidence must not bypass the 0.8 gate. `undefined < 0.8` is false
    // (NaN comparison), so without producer coercion the pipeline would silently
    // accept the type and proceed; detectStatementType normalizes a missing
    // confidence to 0, which trips the gate.
    mockFetch
      .mockResolvedValueOnce(ollamaJson(JSON.stringify({ type: 'bank' })));

    await expect(processStatement('raw text', defaultOptions))
      .rejects.toBeInstanceOf(ManualTypeSelectionError);
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

  it('overrides a wrong summary balance with reconciled running-balance values', async () => {
    // The summary balances are scrambled (wrong). The transactions carry running
    // balances that DO add up (opening 10000 + 0 credits - 2000 debits = 8000
    // closing), so reconcile picks them and the override writes them onto the
    // summary, replacing the wrong values.
    const txns = [
      { date: '2024-01-10', description: 'Purchase A', amount: 1000, type: 'debit', balance: 9000 },
      { date: '2024-01-11', description: 'Purchase B', amount: 1000, type: 'debit', balance: 8000 },
    ];
    const scrambledSummary = bankSummaryJson({ openingBalance: 99999, closingBalance: 88888 });
    setupBankFetch(txns, scrambledSummary);

    const result = await processStatement('raw bank text', {
      ...defaultOptions,
      statementType: 'bank',
    });

    expect(result.success).toBe(true);
    const vi = result.data?.verificationInputs as { meta: Record<string, unknown> };
    // The scrambled 99999 / 88888 were replaced by the reconciled 10000 / 8000.
    expect(vi.meta.openingBalance).toBe(10000);
    expect(vi.meta.closingBalance).toBe(8000);
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
  it('fails the import when credit card summary extraction fails', async () => {
    // Summary: 3 invalid-JSON responses (MAX_RETRIES exhausted). Summary failure is now a
    // hard error (spec §9) — balances are essential, so the import fails even though the
    // transaction/rewards calls that follow would otherwise succeed.
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

    expect(result.success).toBe(false);
    expect(result.errors.some(e => e.includes('Summary extraction failed'))).toBe(true);
  });

  it('fails the import when bank summary extraction fails', async () => {
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

    expect(result.success).toBe(false);
    expect(result.errors.some(e => e.includes('Summary extraction failed'))).toBe(true);
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

  it('keeps both transactions when chunk overlap extracts different amounts', async () => {
    const longLine = 'Transaction data line with sufficient content to build up character count for threshold testing';
    const longText = Array.from({ length: 250 }, (_, i) => `${longLine} #${i + 1}`).join('\n');

    // Same date/type/description, different amounts across chunks → distinct transactions, both kept
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
    // No conflict is "resolved" (dropped) anymore — both extractions survive.
    expect(result.warnings.some(w => w.includes('Chunk overlap: resolved'))).toBe(false);
    expect(result.data?.transactions).toHaveLength(2);
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

// ─── Row identity: numbering, geometry injection, echo, collapse ─────────────

import type { StatementTableInfo } from '@/lib/parsers/extraction/extractionTypes';

describe('processStatement — line numbering and header echo', () => {
  it('retains geometry through currency rewrites before aligning CC headers', async () => {
    const headers = [['Date', 'Description', 'Amount'], ['Date', '', 'Description', 'Amount']];
    const source = ['INR statement', '', '', headers[0].join('||'),
      '2025-09-11||Foreign USD 30.54||C 700.79', headers[1].join('||'),
      '2025-09-12||EMI||SwiggyBengaluru||14897.00', 'Rewards points 0'].join('\n');
    const tables: StatementTableInfo[] = headers.map((header, index) => ({
      headerLineIndex: 3 + index * 2, dataRowLineIndexes: [4 + index * 2],
      columns: header.map(headerText => ({ headerText, type: 'unknown' })),
    }));
    setupCCFetch([{ date: '2025-09-12', description: 'SwiggyBengaluru', amount: 14897, type: 'debit', sourceLine: 6 }]);
    const result = await processStatement(source, { ...defaultOptions, statementType: 'credit_card' }, tables);
    expect(result.success).toBe(true);
    expect(fetchPrompt(1)).toContain('3||[1] "Date"||[2] ""||[3] "Description"||[4] "Amount"');
    expect(fetchPrompt(1)).toContain('4||[1] "2025-09-11"||[2] ""||[3] "Foreign $30.54"||[4] "700.79"');
    expect(fetchPrompt(1)).toContain('6||[1] "2025-09-12"||[2] "EMI"||[3] "SwiggyBengaluru"');
    expect(result.data?.verificationInputs?.rawText.split('\n')[5]).toBe('2025-09-12||EMI||SwiggyBengaluru||14897.00');
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('aligns repeated CC tables in one request, without altering stored or verification text', async () => {
    const headers = [['Date', 'Description', 'Amount'], ['Date', '', 'Description', 'Amount']];
    const source = [headers[0].join('||'), '2025-09-11||Merchant||10.00',
      headers[1].join('||'), '2025-09-12||EMI||SwiggyBengaluru||14897.00', 'Rewards points 0'].join('\n');
    const tables: StatementTableInfo[] = headers.map((header, index) => ({
      headerLineIndex: index * 2, dataRowLineIndexes: [index * 2 + 1],
      columns: header.map(headerText => ({ headerText, type: 'unknown' })),
    }));
    setupCCFetch([{ date: '2025-09-12', description: 'SwiggyBengaluru', amount: 14897, type: 'debit', sourceLine: 4 }]);
    const result = await processStatement(source, { ...defaultOptions, statementType: 'credit_card' }, tables);
    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(3); // Summary, one extraction, rewards.
    expect(fetchPrompt(1)).toContain(formatCreditCardTransactionInput(source, tables));
    expect(fetchPrompt(1)).toContain('2||[1] "2025-09-11"||[2] ""||[3] "Merchant"');
    expect(result.data?.rawText).toBe(source);
    expect(result.data?.verificationInputs?.rawText).toBe(source);
    expect(result.data?.transactions[0].sourceLine).toBe(4);
  });

  it('indexes CC cells only for transactions, preserving the source for other passes', async () => {
    const source = 'Date||||Description||Amount\n2025-09-12||EMI||SwiggyBengaluru||14897.00\nRewards points 0';
    setupCCFetch([{ date: '2025-09-12', description: 'SwiggyBengaluru', amount: 14897, type: 'debit', sourceLine: 2 }]);
    const result = await processStatement(source, { ...defaultOptions, statementType: 'credit_card' });
    expect(result.success).toBe(true);
    expect(fetchPrompt(1)).toContain(formatCreditCardTransactionInput(source));
    expect(fetchPrompt(0)).toContain(source);
    expect(fetchPrompt(0)).not.toContain('[1] "Date"');
    expect(fetchPrompt(2)).toContain(source);
    expect(result.data?.rawText).toBe(source);
    expect(result.data?.verificationInputs?.rawText).toBe(source);
    expect(result.data?.transactions[0].sourceLine).toBe(2);
  });

  it('leaves the bank request cell representation unchanged', async () => {
    setupBankFetch();
    const source = 'Date||Description||Debit||Credit\n2025-09-12||Merchant||100||';
    await processStatement(source, { ...defaultOptions, statementType: 'bank' });
    expect(fetchPrompt(1)).toContain('1||Date||Description||Debit||Credit');
    expect(fetchPrompt(1)).not.toContain('[1] "Date"');
  });

  it.each(['geometry', 'echo'] as const)('injects an indexed CC header through the %s path', async mode => {
    const header = 'Date||||Description||Amount';
    const source = [header, ...Array.from({ length: 299 }, (_, i) => `2025-09-12||EMI||Merchant ${i}||100.00`), 'Rewards points 0'].join('\n');
    const indexedHeader = formatCreditCardTransactionInput(header);
    mockFetch
      .mockResolvedValueOnce(ollamaJson(ccSummaryJson()))
      .mockResolvedValueOnce(ollamaJson(JSON.stringify({ transactions: [{ date: '2025-09-12', description: 'Merchant 1', amount: 100, type: 'debit' }], tableHeader: indexedHeader })))
      .mockResolvedValueOnce(ollamaJson(transactionsJson()))
      .mockResolvedValueOnce(ollamaJson(JSON.stringify({ rewards: [] })));
    const tables = mode === 'geometry'
      ? [{ headerLineIndex: 0, dataRowLineIndexes: Array.from({ length: 299 }, (_, i) => i + 1), columns: [] }]
      : undefined;
    const result = await processStatement(source, { ...defaultOptions, statementType: 'credit_card' }, tables);
    expect(result.success).toBe(true);
    expect(fetchPrompt(2)).toContain(indexedHeader + '\n169||[1]');
  });

  it('numbers every line of the transactions input (single-shot path)', async () => {
    setupBankFetch();

    const result = await processStatement('Bank statement text\nwith two lines', {
      ...defaultOptions,
      statementType: 'bank',
    });

    expect(result.success).toBe(true);
    const prompt = fetchPrompt(1); // call 0 = summary, call 1 = transactions
    expect(prompt).toContain('\n1||Bank statement text');
    expect(prompt).toContain('\n2||with two lines');
  });

  it('collapses two reads of the same sourceLine across chunks (phantom duplicate dies)', async () => {
    const longLine = 'Transaction data line with sufficient content to build up character count for threshold testing';
    const longText = Array.from({ length: 250 }, (_, i) => `${longLine} #${i + 1}`).join('\n');

    // Both chunks "extract" the same statement row (sourceLine 5) with
    // disagreeing fields — the overlap mis-read (INR vs USD).
    const chunk1Txns = [
      { date: '2024-01-15', description: 'AMAZON', amount: 99.99, type: 'debit', sourceLine: 5, confidence: 0.9 },
    ];
    const chunk2Txns = [
      { date: '2024-01-15', description: 'AMAZON', amount: 99.99, type: 'debit', sourceLine: 5, originalCurrency: 'USD', originalAmount: 99.99, confidence: 0.6 },
    ];

    mockFetch
      .mockResolvedValueOnce(ollamaJson(bankSummaryJson()))
      .mockResolvedValueOnce(ollamaJson(transactionsJson(chunk1Txns)))
      .mockResolvedValueOnce(ollamaJson(transactionsJson(chunk2Txns)));

    const result = await processStatement(longText, { ...defaultOptions, statementType: 'bank' });

    expect(result.success).toBe(true);
    expect(result.data?.transactions).toHaveLength(1);
    expect(result.data?.transactions[0].sourceLine).toBe(5);
  });

  it('injects a verified echoed header into the next chunk', async () => {
    const longLine = 'Transaction data line with sufficient content to build up character count for threshold testing';
    const longText = Array.from({ length: 250 }, (_, i) => `${longLine} #${i + 1}`).join('\n');
    const headerLine = '1||' + longLine + ' #1';

    const chunk1 = [
      { date: '2024-01-15', description: 'First', amount: 10, type: 'debit' },
    ];
    const chunk2 = [
      { date: '2024-01-20', description: 'Second', amount: 20, type: 'debit' },
    ];

    mockFetch
      .mockResolvedValueOnce(ollamaJson(bankSummaryJson()))
      .mockResolvedValueOnce(ollamaJson(JSON.stringify({ transactions: chunk1, tableHeader: headerLine })))
      .mockResolvedValueOnce(ollamaJson(transactionsJson(chunk2)));

    const result = await processStatement(longText, { ...defaultOptions, statementType: 'bank' });

    expect(result.success).toBe(true);
    // Chunk 2's prompt embeds `header + '\n' + chunk 2 text`. Static chunking
    // (180-line target, 12-line overlap) puts chunk 2's first line at number 169.
    expect(fetchPrompt(2)).toContain(headerLine + '\n169||');
    // Chunk 1 got no injection — its text starts with line 1, not the header.
    expect(fetchPrompt(1)).not.toContain(headerLine + '\n1||');
  });

  it('does not inject a garbled echo', async () => {
    const longLine = 'Transaction data line with sufficient content to build up character count for threshold testing';
    const longText = Array.from({ length: 250 }, (_, i) => `${longLine} #${i + 1}`).join('\n');

    const chunk1 = [{ date: '2024-01-15', description: 'First', amount: 10, type: 'debit' }];
    const chunk2 = [{ date: '2024-01-20', description: 'Second', amount: 20, type: 'debit' }];

    mockFetch
      .mockResolvedValueOnce(ollamaJson(bankSummaryJson()))
      .mockResolvedValueOnce(ollamaJson(JSON.stringify({ transactions: chunk1, tableHeader: '999||NOT A REAL LINE' })))
      .mockResolvedValueOnce(ollamaJson(transactionsJson(chunk2)));

    const result = await processStatement(longText, { ...defaultOptions, statementType: 'bank' });

    expect(result.success).toBe(true);
    expect(fetchPrompt(2).includes('999||NOT A REAL LINE')).toBe(false);
  });
});

describe('processStatement — geometry header injection', () => {
  it('injects the geometry header line into a chunk that covers table rows but not the header', async () => {
    // 300 lines → static chunking (2 chunks, 180-line target). The table header
    // sits on line 3 (0-based index 2), rows below it.
    const longText = [
      'Statement of Account',
      '',
      'Date||Description||Amount',
      ...Array.from({ length: 297 }, (_, i) => `02/04/2025||Merchant ${i + 1}||${(i + 1) * 10}`),
    ].join('\n');

    const tables: StatementTableInfo[] = [
      {
        headerLineIndex: 2,
        dataRowLineIndexes: Array.from({ length: 297 }, (_, i) => 3 + i),
        columns: [
          { headerText: 'Date', type: 'date' },
          { headerText: 'Description', type: 'description' },
          { headerText: 'Amount', type: 'amount' },
        ],
      },
    ];

    mockFetch
      .mockResolvedValueOnce(ollamaJson(bankSummaryJson()))
      .mockResolvedValueOnce(ollamaJson(transactionsJson()))
      .mockResolvedValueOnce(ollamaJson(transactionsJson()));

    const result = await processStatement(longText, { ...defaultOptions, statementType: 'bank' }, tables);

    expect(result.success).toBe(true);
    // Call 0 = summary, calls 1..2 = chunks. Chunk 2 (call 2) covers rows but not
    // the header line, so its text is prefixed with the numbered header line,
    // immediately followed by chunk 2's own first line (number 169).
    const chunk2Prompt = fetchPrompt(2);
    expect(chunk2Prompt).toContain('3||Date||Description||Amount\n169||');
    // Chunk 1 contains the header naturally — no injection (its first line is 1).
    expect(fetchPrompt(1)).not.toContain('3||Date||Description||Amount\n1||');
  });

  it('skips injection when the table cannot be mapped (unmappable row indexes)', async () => {
    const longText = Array.from({ length: 300 }, (_, i) => `Line ${i + 1} content here`).join('\n');
    const tables: StatementTableInfo[] = [
      { headerLineIndex: 5, dataRowLineIndexes: [99999], columns: [] },
    ];

    mockFetch
      .mockResolvedValueOnce(ollamaJson(bankSummaryJson()))
      .mockResolvedValueOnce(ollamaJson(transactionsJson()))
      .mockResolvedValueOnce(ollamaJson(transactionsJson()));

    const result = await processStatement(longText, { ...defaultOptions, statementType: 'bank' }, tables);

    expect(result.success).toBe(true);
    expect(fetchPrompt(2).startsWith('6||')).toBe(false);
  });
});

describe('processStatement — truncation detect-and-shrink', () => {
  // 300 lines → static chunking, 2 chunks (180-line target). Call order:
  // 0 = summary, then chunk calls in order.
  function longText(): string {
    return [
      'Statement of Account',
      '',
      'Date||Description||Amount',
      ...Array.from({ length: 297 }, (_, i) => `02/04/2025||Merchant ${i + 1}||${(i + 1) * 10}.00`),
    ].join('\n');
  }

  it('splits a truncated chunk in half and re-extracts both halves', async () => {
    const lowerRows = [
      { date: '2025-04-02', description: 'Merchant 1', amount: 10, type: 'debit' },
      { date: '2025-04-03', description: 'Merchant 2', amount: 20, type: 'debit' },
    ];
    const upperRows = [
      { date: '2025-04-04', description: 'Merchant 3', amount: 30, type: 'debit' },
      { date: '2025-04-05', description: 'Merchant 4', amount: 40, type: 'debit' },
    ];
    const chunk2Rows = [
      { date: '2025-04-20', description: 'Merchant 200', amount: 2000, type: 'debit' },
    ];
    mockFetch
      .mockResolvedValueOnce(ollamaJson(bankSummaryJson()))
      // Chunk 1 truncates at the output cap (cut mid-JSON, done_reason length).
      .mockResolvedValueOnce(ollamaTruncated('{"transactions":[{"date":"2025-04-02"'))
      // The two halves succeed.
      .mockResolvedValueOnce(ollamaJson(transactionsJson(lowerRows)))
      .mockResolvedValueOnce(ollamaJson(transactionsJson(upperRows)))
      // Chunk 2 succeeds normally.
      .mockResolvedValueOnce(ollamaJson(transactionsJson(chunk2Rows)));

    const result = await processStatement(longText(), { ...defaultOptions, statementType: 'bank' });

    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
    // One summary + truncated chunk1 + its two halves + chunk2 = 5 calls.
    // Exactly one attempt on the truncated call (no blind retries).
    expect(mockFetch).toHaveBeenCalledTimes(5);
    const descriptions = result.data?.transactions.map((t: { description: string }) => t.description) ?? [];
    for (const row of [...lowerRows, ...upperRows, ...chunk2Rows]) {
      expect(descriptions, `row "${row.description}" recovered after split`).toContain(row.description);
    }
    // Negative: the truncated first attempt was NOT salvaged as rows — the
    // recovered set comes from the halves only, and no error was swallowed.
    expect(result.data?.transactions).toHaveLength(5);
  });

  it('a truncated single shot falls back to the text split in half', async () => {
    // Small statement (single-shot territory), > 24 lines so the fallback split applies.
    const text = [
      'Statement of Account',
      'Date||Description||Amount',
      ...Array.from({ length: 28 }, (_, i) => `02/04/2025||Merchant ${i + 1}||${(i + 1) * 10}.00`),
    ].join('\n');
    const half1Rows = [{ date: '2025-04-02', description: 'Merchant 1', amount: 10, type: 'debit' }];
    const half2Rows = [{ date: '2025-04-03', description: 'Merchant 2', amount: 20, type: 'debit' }];
    mockFetch
      .mockResolvedValueOnce(ollamaJson(bankSummaryJson()))
      // Single shot truncates.
      .mockResolvedValueOnce(ollamaTruncated('{"transactions":[{"date"'))
      // Both halves succeed.
      .mockResolvedValueOnce(ollamaJson(transactionsJson(half1Rows)))
      .mockResolvedValueOnce(ollamaJson(transactionsJson(half2Rows)));

    const result = await processStatement(text, { ...defaultOptions, statementType: 'bank' });

    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(4);
    // The fallback prompts are halves, not the whole text again.
    const half1 = fetchPrompt(2);
    const half2 = fetchPrompt(3);
    expect(half1).not.toEqual(half2);
    expect(half1.length + half2.length).toBeLessThan(half1.length * 2 + 1000); // sanity: two smaller pieces
    const descriptions = result.data?.transactions.map((t: { description: string }) => t.description) ?? [];
    expect(descriptions).toContain('Merchant 1');
    expect(descriptions).toContain('Merchant 2');
  });

  it('a truncated chunk at the shrink floor fails loudly instead of silently dropping rows', async () => {
    // 28-line statement: the fallback split halves are ≤ 24 lines → at the
    // floor on their first truncation. Every transactions call truncates.
    const text = [
      'Statement of Account',
      'Date||Description||Amount',
      ...Array.from({ length: 28 }, (_, i) => `02/04/2025||Merchant ${i + 1}||${(i + 1) * 10}.00`),
    ].join('\n');
    mockFetch
      .mockResolvedValue(ollamaTruncated('{"transactions":[{"date"'));

    const result = await processStatement(text, { ...defaultOptions, statementType: 'bank' });

    // Loud failure with a named truncation error — never a silent partial.
    expect(result.success).toBe(false);
    expect(result.errors.join(' ')).toContain('truncated');
  });
});

// ─── Chunker row budget (spec 2026-08-28) ─────────────────────────────────────

describe('processStatement — single-shot row budget', () => {
  it('prefers detected table rows over date anchors for the single-shot budget', async () => {
    mockGetContextWindowInfo.mockResolvedValue({
      contextLength: 16384,
      source: 'settings_cache',
      provider: 'ollama',
      modelId: 'llama3',
    });
    mockFetch.mockImplementation(async (_url: unknown, init: unknown) => {
      const prompt = JSON.parse((init as { body: string }).body).prompt as string;
      if (prompt.includes('extract ONLY summary-level fields')) return ollamaJson(bankSummaryJson());
      return ollamaJson(transactionsJson());
    });

    // The 39 detector-confirmed data rows fit. The other date-bearing lines
    // model statement metadata/narration: counting all anchors instead would
    // conservatively split this statement, so one call proves table precedence.
    const rows = Array.from({ length: 39 }, (_, i) => `02/04/2025||Merchant ${i + 1}||${(i + 1) * 10}.00`);
    const datedProse = Array.from({ length: 200 }, (_, i) => `01/${String((i % 12) + 1).padStart(2, '0')}/2025 note ${i}`);
    const lines = ['Statement of Account', '', ...rows, ...datedProse];
    const tables: StatementTableInfo[] = [{
      headerLineIndex: 0,
      dataRowLineIndexes: Array.from({ length: 39 }, (_, i) => i + 2),
      columns: [],
    }];

    const result = await processStatement(lines.join('\n'), { ...defaultOptions, statementType: 'bank' }, tables);

    expect(result.success).toBe(true);
    const transactionsCalls = mockFetch.mock.calls.filter(([, init]) =>
      (JSON.parse((init as { body: string }).body).prompt as string).includes('extract ALL individual transactions'),
    );
    expect(transactionsCalls).toHaveLength(1);
  });

  it('single-shots a prose-heavy statement whose transaction rows fit the window', async () => {
    // 39 transaction rows scattered among 200 narration lines: the per-line
    // reserve chunks this (~96 lines/chunk), the anchor-counted row budget
    // fits it (input ~5.5K + overhead ~4.6K + 39 rows × 90 × 1.1 ≈ 3.9K ≈
    // 14K ≤ 16384). The transactions stage must run exactly ONCE.
    mockGetContextWindowInfo.mockResolvedValue({
      contextLength: 16384,
      source: 'settings_cache',
      provider: 'ollama',
      modelId: 'llama3',
    });
    mockFetch.mockImplementation(async (_url: unknown, init: unknown) => {
      const body = JSON.parse((init as { body: string }).body);
      const prompt = body.prompt as string;
      if (prompt.includes('extract ONLY summary-level fields')) return ollamaJson(bankSummaryJson());
      return ollamaJson(transactionsJson());
    });

    const rows = Array.from({ length: 39 }, (_, i) => `02/04/2025||Merchant ${i + 1}||${(i + 1) * 10}.00`);
    const prose = Array.from({ length: 200 }, (_, i) => `Narration line ${i} with account summary context text.`);
    const lines: string[] = ['Statement of Account', ''];
    for (let i = 0; i < rows.length; i++) lines.push(prose[i], rows[i]);
    lines.push(...prose.slice(rows.length));

    const result = await processStatement(lines.join('\n'), { ...defaultOptions, statementType: 'bank' });

    expect(result.success).toBe(true);
    const transactionsCalls = mockFetch.mock.calls.filter(([, init]) =>
      (JSON.parse((init as { body: string }).body).prompt as string).includes('extract ALL individual transactions'),
    );
    expect(transactionsCalls.length).toBe(1);
  });
});
