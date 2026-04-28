import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockNormalize = vi.fn((t: string) => t);
const mockDetectType = vi.fn();
const mockBuildSummaryPrompt = vi.fn(() => 'summary prompt');
const mockBuildTransactionsPrompt = vi.fn(() => 'transactions prompt');
const mockBuildRewardsPrompt = vi.fn(() => 'rewards prompt');
const mockRunWithRetry = vi.fn();
const mockMergeOutputs = vi.fn();
const mockCreateChunkPlan = vi.fn();
const mockGetDroppedCount = vi.fn(() => 0);
const mockMergeChunkTransactions = vi.fn();

type MockFn = (...args: unknown[]) => unknown;

vi.mock('@/lib/parsers/normalization', () => ({
  normalizeStatementText: (...args: unknown[]) => (mockNormalize as MockFn)(...args),
}));

vi.mock('@/lib/parsers/typeDetection', () => ({
  detectStatementType: (...args: unknown[]) => (mockDetectType as MockFn)(...args),
}));

vi.mock('@/lib/parsers/extractSummary', () => ({
  buildSummaryPrompt: (...args: unknown[]) => (mockBuildSummaryPrompt as MockFn)(...args),
}));

vi.mock('@/lib/parsers/extractTransactions', () => ({
  buildTransactionsPrompt: (...args: unknown[]) => (mockBuildTransactionsPrompt as MockFn)(...args),
}));

vi.mock('@/lib/parsers/extractRewards', () => ({
  buildRewardsPrompt: (...args: unknown[]) => (mockBuildRewardsPrompt as MockFn)(...args),
}));

vi.mock('@/lib/parsers/retryEngine', () => ({
  runWithRetry: (...args: unknown[]) => (mockRunWithRetry as MockFn)(...args),
}));

vi.mock('@/lib/verification/mergeEngine', () => ({
  mergeOutputs: (...args: unknown[]) => (mockMergeOutputs as MockFn)(...args),
}));

const mockValidateTransactions = vi.fn();

vi.mock('@/lib/verification/validationEngine', () => ({
  validateCCSummary: vi.fn((d: unknown) => ({ valid: true, errors: [], warnings: [], data: d })),
  validateBankSummary: vi.fn((d: unknown) => ({ valid: true, errors: [], warnings: [], data: d })),
  validateTransactions: (...args: unknown[]) => (mockValidateTransactions as MockFn)(...args),
}));

vi.mock('@/lib/parsers/transactionChunking', () => ({
  createTransactionChunkPlan: (...args: unknown[]) => (mockCreateChunkPlan as MockFn)(...args),
  getDroppedTransactionCount: (...args: unknown[]) => (mockGetDroppedCount as MockFn)(...args),
  mergeChunkTransactions: (...args: unknown[]) => (mockMergeChunkTransactions as MockFn)(...args),
}));

vi.mock('@/lib/utils/debug', () => ({
  debugLog: vi.fn(),
  debugWarn: vi.fn(),
  debugError: vi.fn(),
}));

import { processStatement } from '@/lib/parsers/pipeline';
import type { LLMRuntimeConfig } from '@/lib/llm/types';

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

function mockSuccessfulRetry(data: unknown) {
  return {
    success: true,
    data,
    errors: [],
    warnings: [],
    attempts: 1,
  };
}

function makeExtractedTx(overrides: Record<string, unknown> = {}) {
  return {
    date: '2024-01-15',
    description: 'Amazon Purchase',
    amount: 99.99,
    type: 'debit',
    ...overrides,
  };
}

function makeBankSummary() {
  return {
    statementDate: '2024-01-15',
    openingBalance: 10000,
    closingBalance: 5000,
  };
}

function makeCCSummary() {
  return {
    statementDate: '2024-01-15',
    totalDue: 5000,
    minimumDue: 500,
    creditLimit: 100000,
    previousBalance: 4000,
    purchasesAndCharges: 2000,
    paymentsReceived: 1000,
  };
}

function makeMergedOutput(transactions: unknown[], summary: unknown, warnings: string[] = []) {
  return {
    transactions,
    summary,
    rewards: null,
    derived: {
      totalDebit: 0,
      totalCredit: 0,
      transactionCount: transactions.length,
    },
    meta: { warnings, confidence: 0.9, failedChunks: undefined },
  };
}

function makeSingleChunkPlan() {
  return {
    chunkingUsed: false,
    chunkTriggerReason: 'single_shot' as const,
    normalizedTextLength: 100,
    normalizedLineCount: 10,
    chunks: [{
      text: 'text',
      index: 0,
      totalChunks: 1,
      isFirst: true,
      isLast: true,
      startLine: 0,
      endLine: 9,
      lineCount: 10,
      overlapStartLine: null as number | null,
    }],
  };
}

function setupBankPipeline(transactions: unknown[], summary: ReturnType<typeof makeBankSummary> | null = makeBankSummary()) {
  mockRunWithRetry.mockImplementation((prompt: string) => {
    if (prompt === 'summary prompt') return mockSuccessfulRetry(summary);
    return mockSuccessfulRetry({ transactions });
  });
  mockMergeOutputs.mockReturnValue(makeMergedOutput(transactions, summary));
  mockCreateChunkPlan.mockReturnValue(makeSingleChunkPlan());
  mockValidateTransactions.mockImplementation((d: unknown) => ({
    valid: true,
    errors: [],
    warnings: [],
    data: d,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('processStatement — routing', () => {
  it('uses explicit statementType when provided, skipping detection', async () => {
    setupBankPipeline([makeExtractedTx()]);

    const result = await processStatement('raw text', {
      ...defaultOptions,
      statementType: 'bank',
    });

    expect(result.success).toBe(true);
    expect(mockDetectType).not.toHaveBeenCalled();
  });

  it('calls detectStatementType when no explicit type', async () => {
    setupBankPipeline([makeExtractedTx()]);
    mockDetectType.mockResolvedValue({
      statementType: 'bank',
      confidence: 0.95,
      bankName: 'HDFC',
    });

    const result = await processStatement('raw text', defaultOptions);

    expect(result.success).toBe(true);
    expect(mockDetectType).toHaveBeenCalledWith('raw text', baseConfig, undefined);
  });

  it('returns failure when type detection confidence is below threshold', async () => {
    mockDetectType.mockResolvedValue({
      statementType: 'bank',
      confidence: 0.5,
      bankName: null,
    });

    const result = await processStatement('raw text', defaultOptions);

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('confidence');
    expect(result.errors[0]).toContain('0.5');
    expect(mockRunWithRetry).not.toHaveBeenCalled();
  });

  it('returns pipeline failure on unexpected error', async () => {
    mockDetectType.mockRejectedValue(new Error('Network down'));

    const result = await processStatement('raw text', defaultOptions);

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('Pipeline failed');
    expect(result.errors[0]).toContain('Network down');
  });
});

describe('processStatement — credit card path', () => {
  it('calls rewards prompt for credit card type', async () => {
    const transactions = [makeExtractedTx()];
    const summary = makeCCSummary();

    mockRunWithRetry.mockImplementation((prompt: string) => {
      if (prompt === 'summary prompt') return mockSuccessfulRetry(summary);
      if (prompt === 'rewards prompt') return mockSuccessfulRetry({ rewards: [] });
      return mockSuccessfulRetry({ transactions });
    });
    mockMergeOutputs.mockReturnValue(makeMergedOutput(transactions, summary));
    mockValidateTransactions.mockImplementation((d: unknown) => ({
      valid: true,
      errors: [],
      warnings: [],
      data: d,
    }));

    const result = await processStatement('raw text', {
      ...defaultOptions,
      statementType: 'credit_card',
    });

    expect(result.success).toBe(true);
    expect(mockBuildRewardsPrompt).toHaveBeenCalled();
  });

  it('does not call rewards prompt for bank type', async () => {
    setupBankPipeline([makeExtractedTx()]);

    await processStatement('raw text', {
      ...defaultOptions,
      statementType: 'bank',
    });

    expect(mockBuildRewardsPrompt).not.toHaveBeenCalled();
  });

  it('reasoning from LLM is ephemeral and not stored on canonical transactions', async () => {
    const extractedWithReasoning = [
      makeExtractedTx({
        description: 'CC PAYMENT VIA NEFT',
        amount: 5000,
        type: 'credit',
        transactionSubType: 'bill_payment',
        reasoning: 'Description contains PAYMENT and NEFT → credit/bill_payment',
      }),
      makeExtractedTx({
        description: 'AMAZON.IN',
        amount: 1299,
        type: 'debit',
        transactionSubType: 'purchase',
        reasoning: 'Merchant purchase with no credit indicators → debit/purchase',
      }),
    ];
    const summary = makeCCSummary();

    mockRunWithRetry.mockImplementation((prompt: string) => {
      if (prompt === 'summary prompt') return mockSuccessfulRetry(summary);
      if (prompt === 'rewards prompt') return mockSuccessfulRetry({ rewards: [] });
      return mockSuccessfulRetry({ transactions: extractedWithReasoning });
    });
    mockMergeOutputs.mockReturnValue(makeMergedOutput(extractedWithReasoning, summary));
    mockValidateTransactions.mockImplementation((d: unknown) => ({
      valid: true,
      errors: [],
      warnings: [],
      data: d,
    }));

    const result = await processStatement('raw text', {
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
    const summary = makeBankSummary();
    setupBankPipeline([makeExtractedTx()], summary);

    const result = await processStatement('raw text', {
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
    expect(vi.summary).toBe(summary);
  });

  it('builds credit card verification inputs with total due and payments', async () => {
    const transactions = [makeExtractedTx()];
    const summary = makeCCSummary();

    mockRunWithRetry.mockImplementation((prompt: string) => {
      if (prompt === 'summary prompt') return mockSuccessfulRetry(summary);
      if (prompt === 'rewards prompt') return mockSuccessfulRetry({ rewards: [] });
      return mockSuccessfulRetry({ transactions });
    });
    mockMergeOutputs.mockReturnValue(makeMergedOutput(transactions, summary));
    mockValidateTransactions.mockImplementation((d: unknown) => ({
      valid: true,
      errors: [],
      warnings: [],
      data: d,
    }));

    const result = await processStatement('raw text', {
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

  it('returns undefined verification inputs when summary is null', async () => {
    setupBankPipeline([makeExtractedTx()], null);

    const result = await processStatement('raw text', {
      ...defaultOptions,
      statementType: 'bank',
    });

    expect(result.success).toBe(true);
    expect(result.data?.verificationInputs).toBeUndefined();
  });
});

describe('processStatement — extraction bundle', () => {
  it('catches validateTransactions failure inside buildExtractionBundle', async () => {
    setupBankPipeline([makeExtractedTx()]);

    mockValidateTransactions.mockImplementation(() => ({
      valid: false,
      errors: ['No valid transactions found'],
      warnings: [],
      data: null,
    }));

    const result = await processStatement('raw text', {
      ...defaultOptions,
      statementType: 'bank',
    });

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('Pipeline failed');
    expect(result.errors[0]).toContain('No valid transactions found');
    expect(result.data).toBeNull();
  });

  it('carries warnings from merged output through to result', async () => {
    const transactions = [makeExtractedTx()];
    const summary = makeBankSummary();

    mockRunWithRetry.mockImplementation((prompt: string) => {
      if (prompt === 'summary prompt') return mockSuccessfulRetry(summary);
      return mockSuccessfulRetry({ transactions });
    });
    mockMergeOutputs.mockReturnValue(makeMergedOutput(transactions, summary, ['partial extraction']));
    mockCreateChunkPlan.mockReturnValue(makeSingleChunkPlan());
    mockValidateTransactions.mockImplementation((d: unknown) => ({
      valid: true,
      errors: [],
      warnings: ['low confidence'],
      data: d,
    }));

    const result = await processStatement('raw text', {
      ...defaultOptions,
      statementType: 'bank',
    });

    expect(result.success).toBe(true);
    expect(result.data?.warnings).toContain('partial extraction');
    expect(result.data?.warnings).toContain('low confidence');
  });

  it('resolves currency from default when transactions have no localCurrency', async () => {
    setupBankPipeline([makeExtractedTx()]);

    const result = await processStatement('raw text', {
      ...defaultOptions,
      statementType: 'bank',
    });

    expect(result.success).toBe(true);
    expect(result.data?.currency).toEqual(defaultCurrency);
  });
});

describe('processStatement — adaptive chunking', () => {
  it('exercises multi-chunk bank extraction path', async () => {
    const txChunk1 = [makeExtractedTx({ description: 'Chunk 1 tx' })];
    const txChunk2 = [makeExtractedTx({ description: 'Chunk 2 tx' })];
    const allTx = [...txChunk1, ...txChunk2];
    const summary = makeBankSummary();

    const chunkPlan = {
      chunkingUsed: true,
      chunkTriggerReason: 'line_threshold' as const,
      normalizedTextLength: 15000,
      normalizedLineCount: 300,
      chunks: [
        { text: 'chunk1 text', index: 0, totalChunks: 2, isFirst: true, isLast: false, startLine: 0, endLine: 179, lineCount: 180, overlapStartLine: null as number | null },
        { text: 'chunk2 text', index: 1, totalChunks: 2, isFirst: false, isLast: true, startLine: 168, endLine: 299, lineCount: 132, overlapStartLine: 168 },
      ],
    };

    mockRunWithRetry
      .mockImplementationOnce(() => mockSuccessfulRetry(summary)) // summary
      .mockImplementationOnce(() => mockSuccessfulRetry({ transactions: txChunk1 })) // chunk 1
      .mockImplementationOnce(() => mockSuccessfulRetry({ transactions: txChunk2 })); // chunk 2
    mockCreateChunkPlan.mockReturnValue(chunkPlan);
    mockMergeChunkTransactions.mockReturnValue({
      transactions: allTx,
      duplicatesRemoved: 0,
    });
    mockMergeOutputs.mockReturnValue(makeMergedOutput(allTx, summary));
    mockValidateTransactions.mockImplementation((d: unknown) => ({
      valid: true,
      errors: [],
      warnings: [],
      data: d,
    }));

    const result = await processStatement('raw text', {
      ...defaultOptions,
      statementType: 'bank',
    });

    expect(result.success).toBe(true);
    expect(mockCreateChunkPlan).toHaveBeenCalledWith('raw text');
    expect(mockMergeChunkTransactions).toHaveBeenCalledWith(allTx);
    expect(mockRunWithRetry).toHaveBeenCalledTimes(3); // summary + 2 chunks
  });

  it('handles partial chunk failure with usable data', async () => {
    const txChunk1 = [makeExtractedTx({ description: 'Good chunk' })];
    const summary = makeBankSummary();

    const chunkPlan = {
      chunkingUsed: true,
      chunkTriggerReason: 'line_threshold' as const,
      normalizedTextLength: 15000,
      normalizedLineCount: 300,
      chunks: [
        { text: 'chunk1 text', index: 0, totalChunks: 2, isFirst: true, isLast: false, startLine: 0, endLine: 179, lineCount: 180, overlapStartLine: null as number | null },
        { text: 'chunk2 text', index: 1, totalChunks: 2, isFirst: false, isLast: true, startLine: 168, endLine: 299, lineCount: 132, overlapStartLine: 168 },
      ],
    };

    mockRunWithRetry
      .mockImplementationOnce(() => mockSuccessfulRetry(summary)) // summary
      .mockImplementationOnce(() => mockSuccessfulRetry({ transactions: txChunk1 })) // chunk 1 success
      .mockImplementationOnce(() => ({ // chunk 2 failure
        success: false,
        data: null,
        errors: ['Chunk extraction failed'],
        warnings: [],
        attempts: 3,
      }));
    mockCreateChunkPlan.mockReturnValue(chunkPlan);
    mockMergeChunkTransactions.mockReturnValue({
      transactions: txChunk1,
      duplicatesRemoved: 0,
    });
    mockMergeOutputs.mockReturnValue(makeMergedOutput(txChunk1, summary));
    mockValidateTransactions.mockImplementation((d: unknown) => ({
      valid: true,
      errors: [],
      warnings: [],
      data: d,
    }));

    const result = await processStatement('raw text', {
      ...defaultOptions,
      statementType: 'bank',
    });

    expect(result.success).toBe(true);
    expect(result.data?.transactions).toHaveLength(1);
  });
});

describe('processStatement — signal propagation', () => {
  it('passes signal through to all runWithRetry calls', async () => {
    setupBankPipeline([makeExtractedTx()]);
    const controller = new AbortController();

    await processStatement('raw text', {
      ...defaultOptions,
      statementType: 'bank',
      signal: controller.signal,
    });

    for (const call of mockRunWithRetry.mock.calls) {
      const opts = call[3] as Record<string, unknown>;
      expect(opts.signal).toBe(controller.signal);
    }
  });
});
