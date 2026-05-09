import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { runPostImportJobs } from '@/lib/services/postImportJobService';
import { useTransactionStore } from '@/lib/store/transactionStore';
import { useSettingsStore } from '@/lib/store/settingsStore';
import { Transaction } from '@/models/Transaction';
import { Category } from '@/models/Category';
import { TransactionType } from '@/models/TransactionType';
import { CategorizedBy, SourceType } from '@/types';

// Mock fetch — the only external boundary (LLM HTTP calls go through here)
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── Helpers ────────────────────────────────────────────────────────────────────

function createTestTransaction(id: string, categorizedBy?: CategorizedBy): Transaction {
  return new Transaction(
    id,
    new Date('2024-01-15'),
    'Test transaction',
    100,
    TransactionType.Debit,
    Category.fromId('other')!,
    undefined, undefined, 'Test transaction', undefined,
    undefined, undefined,
    categorizedBy,
    SourceType.Bank,
  );
}

function ollamaCategorizationResponse(results: Array<{ id: string; category: string; confidence: number }>) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({
      response: JSON.stringify(results),
      prompt_eval_count: 10,
      eval_count: 20,
    }),
    text: () => Promise.resolve(JSON.stringify({ response: JSON.stringify(results) })),
  });
}

// ── Setup / Teardown ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  localStorage.clear();

  useTransactionStore.setState({
    transactions: [],
    selectedIds: [],
    isCategorizing: false,
    categorizeProgress: '',
  });
  useSettingsStore.setState({
    llmProvider: 'ollama',
    llmServerUrl: 'http://localhost:11434',
    llmModel: 'llama3',
  });

  // Default: categorization returns empty results (falls back to keyword)
  mockFetch.mockResolvedValue(ollamaCategorizationResponse([]));
});

afterEach(async () => {
  // Flush any pending timers (background categorization cleanup, etc.)
  await vi.advanceTimersByTimeAsync(15000);
  vi.useRealTimers();
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('runPostImportJobs', () => {
  it('triggers both jobs when transactions exist', () => {
    useTransactionStore.setState({ transactions: [createTestTransaction('1')] });

    const jobs = runPostImportJobs();

    expect(jobs).toContain('background_categorization');
    expect(jobs).toContain('anomaly_detection');
  });

  it('skips background categorization when already categorizing', () => {
    useTransactionStore.setState({
      transactions: [createTestTransaction('1')],
      isCategorizing: true,
    });

    const jobs = runPostImportJobs();

    expect(jobs).not.toContain('background_categorization');
    expect(jobs).toContain('anomaly_detection');
  });

  it('skips background categorization when no transactions', () => {
    useTransactionStore.setState({ transactions: [] });

    const jobs = runPostImportJobs();

    expect(jobs).not.toContain('background_categorization');
  });

  it('skips anomaly detection when no transactions', () => {
    useTransactionStore.setState({ transactions: [] });

    const jobs = runPostImportJobs();

    expect(jobs).not.toContain('anomaly_detection');
  });

  it('returns empty array when no transactions exist', () => {
    useTransactionStore.setState({ transactions: [] });

    expect(runPostImportJobs()).toEqual([]);
  });

  it('does not schedule duplicate background categorization', () => {
    useTransactionStore.setState({ transactions: [createTestTransaction('1')] });

    const jobs1 = runPostImportJobs();
    const jobs2 = runPostImportJobs();

    expect(jobs1).toContain('background_categorization');
    expect(jobs2).not.toContain('background_categorization');
  });

  it('sets isCategorizing=true when background categorization starts', async () => {
    useTransactionStore.setState({
      transactions: [createTestTransaction('1', CategorizedBy.AI)],
    });

    let wasCategorizing = false;
    const unsub = useTransactionStore.subscribe((state) => {
      if (state.isCategorizing) wasCategorizing = true;
    });

    runPostImportJobs();
    await vi.advanceTimersByTimeAsync(6000);
    unsub();

    expect(wasCategorizing).toBe(true);
  });

  it('sets isCategorizing=false after background categorization completes', async () => {
    useTransactionStore.setState({
      transactions: [createTestTransaction('1', CategorizedBy.AI)],
    });

    runPostImportJobs();
    await vi.advanceTimersByTimeAsync(6000);

    expect(useTransactionStore.getState().isCategorizing).toBe(false);
  });

  it('skips categorization when all transactions are manually categorized', async () => {
    useTransactionStore.setState({
      transactions: [createTestTransaction('1', CategorizedBy.Manual)],
    });

    runPostImportJobs();
    await vi.advanceTimersByTimeAsync(6000);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(useTransactionStore.getState().isCategorizing).toBe(false);
  });

  it('sets error state when categorization fails due to missing model', async () => {
    useTransactionStore.setState({
      transactions: [createTestTransaction('1', CategorizedBy.AI)],
    });
    // Empty model triggers a throw in categorizeTransactions before reaching runCategorizationCore
    useSettingsStore.setState({ llmModel: '' });

    runPostImportJobs();
    await vi.advanceTimersByTimeAsync(6000);

    expect(useTransactionStore.getState().isCategorizing).toBe(false);
    expect(useTransactionStore.getState().categorizeProgress).toContain('Categorization failed');
    expect(useTransactionStore.getState().categorizeProgress).toContain('model');
  });

  it('uses settings store for LLM config', async () => {
    const tx = createTestTransaction('1', CategorizedBy.AI);
    useTransactionStore.setState({ transactions: [tx] });

    runPostImportJobs();
    await vi.advanceTimersByTimeAsync(6000);

    // The fetch should have been called with the Ollama endpoint
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:11434/api/generate',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
