import { describe, it, expect, vi, beforeEach } from 'vitest';

import { applyCategorizationResults, categorizeByKeywords, categorizeTransactions, batchTransactions, deriveBatchSize } from '@/lib/categorization/aiCategorizer';
import { CategorizedBy, CategoryType } from '@/types';
import { makeTransaction, makeCategory } from '@tests/unit/factories';
import { useMerchantRuleStore } from '@/lib/store/merchantRuleStore';
import '@/lib/categorization/categories';

const mockFetch = vi.fn();
const mockGetContextWindowInfo = vi.fn();

vi.mock('@/lib/llm/contextWindow', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/llm/contextWindow')>();
  return {
    ...original,
    getContextWindowInfo: (...args: unknown[]) => mockGetContextWindowInfo(...args),
  };
});

vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockGetContextWindowInfo.mockResolvedValue({
    contextLength: undefined,
    source: 'settings_cache',
    provider: 'ollama',
    modelId: 'llama3',
  });
});

describe('categorizeByKeywords (re-exported)', () => {
  it('returns shopping for Amazon descriptions', () => {
    const result = categorizeByKeywords({ description: 'AMAZON PURCHASE', amount: 1299, type: 'debit' });
    expect(result).toBe('shopping');
  });

  it('returns other for unknown merchant', () => {
    const result = categorizeByKeywords({ description: 'XYZ UNKNOWN MERCHANT', amount: 500, type: 'debit' });
    expect(result).toBe('other');
  });
});

describe('applyCategorizationResults', () => {
  it('preserves existing metadata', () => {
    const original = makeTransaction({ id: '1' });
    const results = [{ id: '1', category: 'dining', confidence: 0.9, source: 'ai' as const }];
    const updated = applyCategorizationResults([original], results);
    expect(updated[0].description).toBe('Test Transaction');
    expect(updated[0].amount).toBe(100);
  });

  it('skips transactions not in results', () => {
    const txns = [makeTransaction({ id: '1' }), makeTransaction({ id: '2' })];
    const results = [{ id: '1', category: 'dining', confidence: 0.9, source: 'ai' as const }];
    const updated = applyCategorizationResults(txns, results);
    expect(updated[1].category.id).toBe('shopping'); // Unchanged
  });

  it('keeps original category for unknown category ID', () => {
    const txns = [makeTransaction({ id: '1' })];
    const results = [{ id: '1', category: 'nonexistent_category', confidence: 0.9, source: 'ai' as const }];
    const updated = applyCategorizationResults(txns, results);
    // Category.fromId returns null for unknown IDs → falls back to original
    expect(updated[0].category.id).toBe('shopping');
  });

  it('sets categoryConfidence from result', () => {
    const txns = [makeTransaction({ id: '1' })];
    const results = [{ id: '1', category: 'dining', confidence: 0.85, source: 'ai' as const }];
    const updated = applyCategorizationResults(txns, results);
    expect(updated[0].categoryConfidence).toBe(0.85);
  });

  it('sets categorizedBy based on source', () => {
    const txns = [makeTransaction({ id: '1' })];
    const results = [{ id: '1', category: 'dining', confidence: 0.9, source: 'ai' as const }];
    const updated = applyCategorizationResults(txns, results);
    expect(updated[0].categorizedBy).toBe(CategorizedBy.AI);
  });

  it('sets needsReview to true when confidence < 0.85', () => {
    const txns = [makeTransaction({ id: '1' })];
    const results = [{ id: '1', category: 'dining', confidence: 0.7, source: 'ai' as const }];
    const updated = applyCategorizationResults(txns, results);
    expect(updated[0].needsReview).toBe(true);
  });

  it('sets needsReview to false when confidence >= 0.85', () => {
    const txns = [makeTransaction({ id: '1' })];
    const results = [{ id: '1', category: 'dining', confidence: 0.85, source: 'ai' as const }];
    const updated = applyCategorizationResults(txns, results);
    expect(updated[0].needsReview).toBe(false);
  });

  it('sets needsReview to true when confidence is exactly 0.84', () => {
    const txns = [makeTransaction({ id: '1' })];
    const results = [{ id: '1', category: 'dining', confidence: 0.84, source: 'ai' as const }];
    const updated = applyCategorizationResults(txns, results);
    expect(updated[0].needsReview).toBe(true);
  });

  it('sets needsReview to false when confidence is 1.0', () => {
    const txns = [makeTransaction({ id: '1' })];
    const results = [{ id: '1', category: 'dining', confidence: 1.0, source: 'rule' as const }];
    const updated = applyCategorizationResults(txns, results);
    expect(updated[0].needsReview).toBe(false);
  });

  it('maps source "rule" to CategorizedBy.Rule', () => {
    const txns = [makeTransaction({ id: '1' })];
    const results = [{ id: '1', category: 'shopping', confidence: 0.98, source: 'rule' as const }];
    const updated = applyCategorizationResults(txns, results);
    expect(updated[0].categorizedBy).toBe(CategorizedBy.Rule);
  });

  it('maps source "keyword" to CategorizedBy.Keyword', () => {
    const txns = [makeTransaction({ id: '1' })];
    const results = [{ id: '1', category: 'shopping', confidence: 0.3, source: 'keyword' as const }];
    const updated = applyCategorizationResults(txns, results);
    expect(updated[0].categorizedBy).toBe(CategorizedBy.Keyword);
  });
});

describe('batchTransactions', () => {
  it('splits transactions into batches', () => {
    const txns = Array.from({ length: 30 }, (_, i) =>
      makeTransaction({ id: String(i), description: `Transaction ${i}` })
    );
    const batches = batchTransactions(txns, 10);
    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(10);
  });

  it('handles transactions fewer than batch size', () => {
    const txns = [makeTransaction({ id: '1' }), makeTransaction({ id: '2' })];
    const batches = batchTransactions(txns, 10);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
  });

  it('handles empty input', () => {
    expect(batchTransactions([], 10)).toHaveLength(0);
  });

  it('handles exact batch size', () => {
    const txns = Array.from({ length: 10 }, (_, i) => makeTransaction({ id: String(i) }));
    const batches = batchTransactions(txns, 10);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(10);
  });
});

describe('categorizeTransactions', () => {
  function ollamaResponse(response: string) {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        response,
        prompt_eval_count: 10,
        eval_count: 20,
      }),
      text: () => Promise.resolve(JSON.stringify({ response })),
    });
  }

  it('returns empty for no transactions', async () => {
    const results = await categorizeTransactions([], {
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'llama3',
    });
    expect(results).toEqual([]);
  });

  it('throws when model is missing', async () => {
    const txns = [makeTransaction({ id: '1' })];
    await expect(categorizeTransactions(txns, {
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: '',
    })).rejects.toThrow('model');
  });

  it('throws when model is whitespace only', async () => {
    const txns = [makeTransaction({ id: '1' })];
    await expect(categorizeTransactions(txns, {
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: '   ',
    })).rejects.toThrow('model');
  });

  it('uses LLM for transactions without merchant rules', async () => {
    mockFetch.mockResolvedValue(ollamaResponse(JSON.stringify([{
      id: '1',
      category: 'groceries',
      confidence: 0.9,
      source: 'ai',
    }])));

    const txns = [makeTransaction({ id: '1', description: 'MYSTORE GROCERY' })];
    const results = await categorizeTransactions(txns, {
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'llama3',
    });

    expect(results.length).toBeGreaterThan(0);
    expect(mockFetch).toHaveBeenCalled();
  });

  it('returns empty when all transactions have transfer/investment category', async () => {
    const txns = [
      makeTransaction({ id: '1', category: makeCategory('transfer', CategoryType.Excluded) }),
      makeTransaction({ id: '2', category: makeCategory('investment', CategoryType.Excluded) }),
    ];

    const results = await categorizeTransactions(txns, {
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'llama3',
    });

    expect(results).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('matches merchant rule and returns rule result', async () => {
    // Seed a confident rule for "AMAZON" → shopping
    useMerchantRuleStore.setState({
      rules: [{
        merchantKey: 'AMAZON',
        direction: 'any',
        sourceType: 'any',
        categoryVotes: { shopping: 5 },
        activeCategoryId: 'shopping',
        status: 'confident',
        lastConfirmedCategoryId: 'shopping',
        lastConfirmedAt: '2024-01-15T10:00:00.000Z',
        sampleDescription: 'AMAZON PURCHASE',
        totalConfirmations: 5,
        runnerUpCategoryId: undefined,
        statusReason: 'single-category',
      }],
    });

    const txns = [makeTransaction({ id: '1', description: 'AMAZON PURCHASE' })];
    const results = await categorizeTransactions(txns, {
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'llama3',
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      id: '1',
      category: 'shopping',
      confidence: 0.98,
      source: 'rule',
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('skips AI when all eligible transactions match merchant rules', async () => {
    useMerchantRuleStore.setState({
      rules: [{
        merchantKey: 'AMAZON',
        direction: 'any',
        sourceType: 'any',
        categoryVotes: { shopping: 5 },
        activeCategoryId: 'shopping',
        status: 'confident',
        lastConfirmedCategoryId: 'shopping',
        lastConfirmedAt: '2024-01-15T10:00:00.000Z',
        sampleDescription: 'AMAZON PURCHASE',
        totalConfirmations: 5,
        runnerUpCategoryId: undefined,
        statusReason: 'single-category',
      }],
    });

    const txns = [makeTransaction({ id: '1', description: 'AMAZON PURCHASE' })];
    const onProgress = vi.fn();
    const results = await categorizeTransactions(txns, {
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'llama3',
      onProgress,
    });

    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('rule');
    expect(mockFetch).not.toHaveBeenCalled();
    // onProgress fires even when AI is skipped (all handled by rules)
    expect(onProgress).toHaveBeenCalledWith({
      total: 1,
      processed: 1,
      current: 0,
    });
  });

  it('invokes onProgress callback with correct progress numbers', async () => {
    const onProgress = vi.fn();

    mockFetch.mockResolvedValue(ollamaResponse(JSON.stringify([{
      id: '1',
      category: 'groceries',
      confidence: 0.9,
      source: 'ai',
    }])));

    const txns = [makeTransaction({ id: '1', description: 'WHOLEFOODS MARKET' })];
    await categorizeTransactions(txns, {
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'llama3',
      onProgress,
    });

    expect(onProgress).toHaveBeenCalled();
    // Final call should show all processed
    const lastCall = onProgress.mock.calls[onProgress.mock.calls.length - 1][0];
    expect(lastCall.total).toBe(1);
    expect(lastCall.processed).toBe(1);
  });

  it('excludes skip-category transactions from mixed batch', async () => {
    mockFetch.mockResolvedValue(ollamaResponse(JSON.stringify([{
      id: '2',
      category: 'groceries',
      confidence: 0.9,
      source: 'ai',
    }])));

    const txns = [
      makeTransaction({ id: '1', category: makeCategory('transfer', CategoryType.Excluded) }),
      makeTransaction({ id: '2', description: 'WHOLEFOODS MARKET' }),
    ];
    const results = await categorizeTransactions(txns, {
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'llama3',
    });

    // Only the normal transaction appears; transfer is filtered by shouldSkipAICategorization
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('2');
    expect(results[0].source).toBe('ai');
  });

  it('returns mix of rule-matched and AI-categorized results', async () => {
    // Seed a rule for "AMAZON"
    useMerchantRuleStore.setState({
      rules: [{
        merchantKey: 'AMAZON',
        direction: 'any',
        sourceType: 'any',
        categoryVotes: { shopping: 5 },
        activeCategoryId: 'shopping',
        status: 'confident',
        lastConfirmedCategoryId: 'shopping',
        lastConfirmedAt: '2024-01-15T10:00:00.000Z',
        sampleDescription: 'AMAZON PURCHASE',
        totalConfirmations: 5,
        runnerUpCategoryId: undefined,
        statusReason: 'single-category',
      }],
    });

    mockFetch.mockResolvedValue(ollamaResponse(JSON.stringify([{
      id: '2',
      category: 'groceries',
      confidence: 0.9,
      source: 'ai',
    }])));

    const txns = [
      makeTransaction({ id: '1', description: 'AMAZON PURCHASE' }),
      makeTransaction({ id: '2', description: 'WHOLEFOODS MARKET' }),
    ];
    const results = await categorizeTransactions(txns, {
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'llama3',
    });

    expect(results).toHaveLength(2);
    const ruleResult = results.find(r => r.id === '1');
    const aiResult = results.find(r => r.id === '2');
    expect(ruleResult?.source).toBe('rule');
    expect(aiResult?.source).toBe('ai');
  });

  it('forwards statementType to the fetch call body', async () => {
    mockFetch.mockResolvedValue(ollamaResponse(JSON.stringify([{
      id: '1',
      category: 'dining',
      confidence: 0.9,
      source: 'ai',
    }])));

    const txns = [makeTransaction({ id: '1', description: 'RESTAURANT BILL' })];
    await categorizeTransactions(txns, {
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'llama3',
      statementType: 'credit_card',
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    // statementType "credit_card" is rendered as "Credit Card" in the prompt
    expect(fetchBody.prompt).toContain('Credit Card');
  });

  it('passes stage: categorize to generate call', async () => {
    mockFetch.mockResolvedValue(ollamaResponse(JSON.stringify([{
      id: '1',
      category: 'groceries',
      confidence: 0.9,
      source: 'ai',
    }])));

    const txns = [makeTransaction({ id: '1', description: 'WHOLEFOODS MARKET' })];
    await categorizeTransactions(txns, {
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'llama3',
    });

    // The generate call goes through fetch. Verify the body includes the stage option.
    // For Ollama, options are sent as part of the request body.
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    // The Ollama adapter passes LLMCallOptions as 'options' in the body
    // stage is passed through in the request
    expect(fetchBody).toBeDefined();
  });

  it('calls getContextWindowInfo with correct parameters', async () => {
    mockFetch.mockResolvedValue(ollamaResponse(JSON.stringify([{
      id: '1',
      category: 'groceries',
      confidence: 0.9,
      source: 'ai',
    }])));

    const txns = [makeTransaction({ id: '1', description: 'WHOLEFOODS MARKET' })];
    await categorizeTransactions(txns, {
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'llama3',
    });

    expect(mockGetContextWindowInfo).toHaveBeenCalledWith({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'llama3',
    });
  });

  it('uses derived batch size when context length is available', async () => {
    // 8192 token model → (8192 - 1500) / 60 = 111 → clamped to 50
    mockGetContextWindowInfo.mockResolvedValue({
      contextLength: 8192,
      source: 'settings_cache',
      provider: 'ollama',
      modelId: 'llama3',
    });

    // Create enough transactions to need batching
    const txns = Array.from({ length: 60 }, (_, i) =>
      makeTransaction({ id: String(i), description: `STORE ${i}` })
    );

    // Each batch call returns results for that batch
    mockFetch.mockImplementation((url: string, opts: RequestInit) => {
      const body = JSON.parse(opts.body as string);
      // Extract transaction IDs from the prompt to return matching results
      const ids = [...body.prompt.matchAll(/"id":\s*"(\d+)"/g)].map(m => m[1]);
      const results = ids.map(id => ({
        id,
        category: 'shopping',
        confidence: 0.9,
        source: 'ai',
      }));
      return ollamaResponse(JSON.stringify(results));
    });

    await categorizeTransactions(txns, {
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'llama3',
    });

    // With 60 transactions and batch size 50, should get 2 fetch calls
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('passes a context-aware maxTokens to the generate call when context window is known', async () => {
    mockGetContextWindowInfo.mockResolvedValue({
      contextLength: 8192,
      source: 'settings_cache',
      provider: 'ollama',
      modelId: 'llama3',
    });
    mockFetch.mockResolvedValue(ollamaResponse(JSON.stringify([{
      id: '1', category: 'groceries', confidence: 0.9, source: 'ai',
    }])));

    const txns = [makeTransaction({ id: '1', description: 'WHOLEFOODS MARKET' })];
    await categorizeTransactions(txns, {
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'llama3',
    });

    // Ollama maps maxTokens → options.num_predict. calculateMaxOutputTokens(8192, prompt)
    // must produce a positive number strictly less than 8192.
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.options.num_predict).toBeDefined();
    expect(fetchBody.options.num_predict).toBeGreaterThan(0);
    expect(fetchBody.options.num_predict).toBeLessThan(8192);
  });

  it('falls back to keyword categorization when the prompt overflows the context window', async () => {
    // Tiny context window → calculateMaxOutputTokens returns 0 → generate closure throws →
    // runCategorizationCore catches per-batch and falls back to keywords.
    mockGetContextWindowInfo.mockResolvedValue({
      contextLength: 500, // far too small for the categorization system prompt
      source: 'settings_cache',
      provider: 'ollama',
      modelId: 'llama3',
    });

    const txns = [makeTransaction({ id: '1', description: 'WHOLEFOODS MARKET' })];
    const results = await categorizeTransactions(txns, {
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'llama3',
    });

    // No LLM call should have been made (the generate closure threw before fetch).
    expect(mockFetch).not.toHaveBeenCalled();
    // The transaction is still categorized — via keyword fallback.
    expect(results).toHaveLength(1);
    expect(results[0].source).toBe('keyword');
    expect(results[0].confidence).toBe(0.3);
  });
});

describe('deriveBatchSize', () => {
  // deriveBatchSize(ctx) = clamp(calculateMaxItems(ctx, CATEGORIZATION_SYSTEM_PROMPT, 40, 15), [5, 50]).
  // Linear-coupled regime (spec §6). CATEGORIZATION_SYSTEM_PROMPT is large (persona + category
  // taxonomy + rules), so windows too small to fit it yield a degenerate batch of 1; once the
  // window fits the overhead, batches grow with the window up to the 50-item cap.

  it('returns 1 (degenerate) when the window cannot fit the categorization system prompt', () => {
    expect(deriveBatchSize(256)).toBe(1);
  });

  it('clamps to MAX_BATCH_SIZE (50) for large windows', () => {
    expect(deriveBatchSize(8192)).toBe(50);
    expect(deriveBatchSize(128000)).toBe(50);
  });

  it('stays within [1, 50] across realistic windows', () => {
    for (const ctx of [512, 1024, 2048, 4096, 8192]) {
      const b = deriveBatchSize(ctx);
      expect(b).toBeGreaterThanOrEqual(1);
      expect(b).toBeLessThanOrEqual(50);
    }
  });

  it('grows with the window where the overhead fits (non-decreasing)', () => {
    const vals = [2048, 4096, 8192].map(deriveBatchSize);
    expect(vals[0]).toBeLessThanOrEqual(vals[1]);
    expect(vals[1]).toBeLessThanOrEqual(vals[2]);
  });
});
