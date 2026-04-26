import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockSetState,
  mockGetState,
  mockTransactionStoreState,
  mockSettingsState,
  mockRecategorize,
  mockMergeRecategorized,
} = vi.hoisted(() => {
  const state: {
    transactions: unknown[];
    isCategorizing: boolean;
    categorizeProgress: string;
  } = {
    transactions: [],
    isCategorizing: false,
    categorizeProgress: '',
  };

  const setState = vi.fn((update: Record<string, unknown>) => {
    Object.assign(state, update);
  });

  const getState = vi.fn(() => state);

  return {
    mockSetState: setState,
    mockGetState: getState,
    mockTransactionStoreState: state,
    mockSettingsState: {
      llmProvider: 'ollama',
      llmServerUrl: 'http://localhost:11434',
      llmModel: 'llama3',
    },
    mockRecategorize: vi.fn(),
    mockMergeRecategorized: vi.fn(),
  };
});

vi.mock('@/lib/store/transactionStore', () => ({
  useTransactionStore: {
    getState: () => mockGetState(),
    setState: (...args: unknown[]) => mockSetState(...args),
  },
}));

vi.mock('@/lib/store/settingsStore', () => ({
  useSettingsStore: {
    getState: () => mockSettingsState,
  },
}));

vi.mock('@/lib/services/transactionEnrichmentService', () => ({
  recategorizeStoredTransactions: (...args: unknown[]) => mockRecategorize(...args),
  mergeRecategorizedTransactions: (...args: unknown[]) => mockMergeRecategorized(...args),
}));

vi.mock('@/lib/anomaly/detector', () => ({
  detectAnomalies: vi.fn((txns: unknown[]) => txns),
}));

vi.mock('@/lib/utils/debug', () => ({
  debugLog: vi.fn(),
  debugWarn: vi.fn(),
  debugError: vi.fn(),
}));

import { runPostImportJobs } from '@/lib/services/postImportJobService';

beforeEach(() => {
  vi.useFakeTimers();
  mockTransactionStoreState.transactions = [];
  mockTransactionStoreState.isCategorizing = false;
  mockTransactionStoreState.categorizeProgress = '';
  mockRecategorize.mockResolvedValue([]);
  mockMergeRecategorized.mockReturnValue([]);
});

afterEach(async () => {
  // Flush the pending background categorization timer so the module-level
  // pendingBackgroundCategorizationTimer guard is cleared for the next test.
  await vi.advanceTimersByTimeAsync(15000);
  vi.useRealTimers();
});

describe('runPostImportJobs', () => {
  it('triggers both jobs when transactions exist', () => {
    mockTransactionStoreState.transactions = [
      { id: '1', amount: 100 },
    ];

    const jobs = runPostImportJobs();

    expect(jobs).toContain('background_categorization');
    expect(jobs).toContain('anomaly_detection');
  });

  it('skips background categorization when already categorizing', () => {
    mockTransactionStoreState.transactions = [{ id: '1' }];
    mockTransactionStoreState.isCategorizing = true;

    const jobs = runPostImportJobs();

    expect(jobs).not.toContain('background_categorization');
    expect(jobs).toContain('anomaly_detection');
  });

  it('skips background categorization when no transactions', () => {
    mockTransactionStoreState.transactions = [];

    const jobs = runPostImportJobs();

    expect(jobs).not.toContain('background_categorization');
  });

  it('skips anomaly detection when no transactions', () => {
    mockTransactionStoreState.transactions = [];

    const jobs = runPostImportJobs();

    expect(jobs).not.toContain('anomaly_detection');
  });

  it('returns empty array when no transactions exist', () => {
    mockTransactionStoreState.transactions = [];

    expect(runPostImportJobs()).toEqual([]);
  });

  it('does not schedule duplicate background categorization', () => {
    mockTransactionStoreState.transactions = [{ id: '1' }];

    const jobs1 = runPostImportJobs();
    const jobs2 = runPostImportJobs();

    expect(jobs1).toContain('background_categorization');
    expect(jobs2).not.toContain('background_categorization');
  });

  it('sets isCategorizing=true when background categorization starts', async () => {
    mockTransactionStoreState.transactions = [
      { id: '1', categorizedBy: 'ai', amount: 100 },
    ];

    runPostImportJobs();
    await vi.advanceTimersByTimeAsync(6000);

    expect(mockSetState).toHaveBeenCalledWith(
      expect.objectContaining({ isCategorizing: true }),
    );
  });

  it('sets isCategorizing=false after background categorization completes', async () => {
    const tx = { id: '1', categorizedBy: 'ai', amount: 100 };
    mockTransactionStoreState.transactions = [tx];
    mockRecategorize.mockResolvedValue([{ ...tx, category: { id: 'food' } }]);
    mockMergeRecategorized.mockReturnValue([{ ...tx, category: { id: 'food' } }]);

    runPostImportJobs();
    await vi.advanceTimersByTimeAsync(6000);

    expect(mockSetState).toHaveBeenCalledWith(
      expect.objectContaining({ isCategorizing: false }),
    );
  });

  it('filters to non-manual transactions for recategorization', async () => {
    const aiTx = { id: '1', categorizedBy: 'ai', amount: 100 };
    const manualTx = { id: '2', categorizedBy: 'manual', amount: 200 };
    mockTransactionStoreState.transactions = [aiTx, manualTx];
    mockRecategorize.mockResolvedValue([]);
    mockMergeRecategorized.mockReturnValue([aiTx, manualTx]);

    runPostImportJobs();
    await vi.advanceTimersByTimeAsync(6000);

    expect(mockRecategorize).toHaveBeenCalledWith(
      [aiTx],
      expect.any(Object),
    );
  });

  it('skips categorization when all transactions are manually categorized', async () => {
    mockTransactionStoreState.transactions = [
      { id: '1', categorizedBy: 'manual', amount: 100 },
    ];

    runPostImportJobs();
    await vi.advanceTimersByTimeAsync(6000);

    expect(mockSetState).toHaveBeenCalledWith(
      expect.objectContaining({ isCategorizing: false }),
    );
    expect(mockRecategorize).not.toHaveBeenCalled();
  });

  it('sets error state when recategorization fails', async () => {
    mockTransactionStoreState.transactions = [
      { id: '1', categorizedBy: 'ai', amount: 100 },
    ];
    mockRecategorize.mockRejectedValue(new Error('LLM connection refused'));

    runPostImportJobs();
    await vi.advanceTimersByTimeAsync(6000);

    expect(mockSetState).toHaveBeenCalledWith(
      expect.objectContaining({
        isCategorizing: false,
        categorizeProgress: expect.stringContaining('LLM connection refused'),
      }),
    );
  });

  it('uses settings store for LLM config', async () => {
    mockTransactionStoreState.transactions = [
      { id: '1', categorizedBy: 'ai', amount: 100 },
    ];

    runPostImportJobs();
    await vi.advanceTimersByTimeAsync(6000);

    expect(mockRecategorize).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        provider: 'ollama',
        baseUrl: 'http://localhost:11434',
        model: 'llama3',
      }),
    );
  });
});
