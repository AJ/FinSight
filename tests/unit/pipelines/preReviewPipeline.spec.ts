import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runPreReviewPipeline } from '@/lib/pipelines/preReviewPipeline';
import { reviewSessionRepository } from '@/lib/review/reviewSessionRepository';
import '@/lib/categorization/categories';

// Mock fetch at the network boundary so the real enrichment pipeline runs.
// When the LLM adapter calls fetch, it gets a network error, causing
// runCategorizationCore to fall back to keyword-based categorization.
const mockFetch = vi.fn(() => Promise.reject(new TypeError('Network error')));
vi.stubGlobal('fetch', mockFetch);

function createCSVFile(content: string, name = 'test.csv'): File {
  return new File([content], name, { type: 'text/csv' });
}

const INR = { code: 'INR', symbol: '₹', name: 'Indian Rupee' };

describe('runPreReviewPipeline', () => {
  beforeEach(() => {
    sessionStorage.clear();
    mockFetch.mockClear();
  });

  it('processes a CSV bank statement end-to-end', async () => {
    const csv = `Date,Description,Amount,Type
20/10/2025,Salary Credit,1000,credit
21/10/2025,Coffee Shop,250,debit`;

    const result = await runPreReviewPipeline({
      file: createCSVFile(csv),
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'test-model',
      defaultCurrency: INR,
    });

    // Transaction count
    expect(result.transactions).toHaveLength(2);
    expect(result.statementType).toBeNull(); // CSV parser sets null
    expect(result.format).toBe('csv');
    expect(result.fileName).toBe('test.csv');
    expect(result.currency).toEqual(INR);
    expect(result.parseDate).toBeInstanceOf(Date);

    // Transaction content
    expect(result.transactions[0].description).toBe('Salary Credit');
    expect(result.transactions[0].amount).toBe(1000);
    expect(result.transactions[0].type).toBe('credit');
    expect(result.transactions[1].description).toBe('Coffee Shop');
    expect(result.transactions[1].amount).toBe(250);
    expect(result.transactions[1].type).toBe('debit');

    // Session saved to sessionStorage
    const saved = reviewSessionRepository.load();
    expect(saved).toBeDefined();
    expect(saved!.transactions).toHaveLength(2);
    expect(saved!.fileName).toBe('test.csv');
  });

  it('reports rows with unparseable dates as warnings', async () => {
    // parseRow returns a ParsingError when parseDate() fails.
    // These are captured as warnings in the ExtractionBundle.
    const csv = `Date,Description,Amount,Type
20/10/2025,Salary Credit,1000,credit
not-a-date,Bad Row,abc,debit
21/10/2025,Coffee Shop,250,debit`;

    const result = await runPreReviewPipeline({
      file: createCSVFile(csv),
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'test-model',
      defaultCurrency: INR,
    });

    expect(result.transactions).toHaveLength(2);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('1 row(s) failed to parse');
  });

  it('throws when CSV has no date column', async () => {
    const csv = `Description,Amount
Some purchase,100`;

    await expect(
      runPreReviewPipeline({
        file: createCSVFile(csv),
        provider: 'ollama',
        baseUrl: 'http://localhost:11434',
        defaultCurrency: INR,
      }),
    ).rejects.toThrow('date column');
  });

  it('uses default currency when CSV has no currency indicators', async () => {
    const csv = `Date,Description,Amount,Type
20/10/2025,Salary,5000,credit`;

    const result = await runPreReviewPipeline({
      file: createCSVFile(csv),
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'test-model',
      defaultCurrency: INR,
    });

    // Currency falls back to default when CSV has no indicators
    expect(result.currency).toEqual(INR);
  });

  it('session payload has correct structure', async () => {
    const csv = `Date,Description,Amount,Type
20/10/2025,Salary,5000,credit`;

    await runPreReviewPipeline({
      file: createCSVFile(csv),
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'test-model',
      defaultCurrency: INR,
    });

    const saved = reviewSessionRepository.load();
    expect(saved).not.toBeNull();
    expect(saved!).toHaveProperty('transactions');
    expect(saved!).toHaveProperty('currency');
    expect(saved!).toHaveProperty('format');
    expect(saved!).toHaveProperty('statementType');
    expect(saved!).toHaveProperty('fileName');
    expect(saved!).toHaveProperty('parseDate');
    expect(saved!).toHaveProperty('warnings');
  });

  it('clears session and saves fresh on second upload', async () => {
    const csv1 = `Date,Description,Amount,Type
20/10/2025,Salary,5000,credit`;

    await runPreReviewPipeline({
      file: createCSVFile(csv1, 'first.csv'),
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'test-model',
      defaultCurrency: INR,
    });

    const csv2 = `Date,Description,Amount,Type
21/10/2025,Coffee,200,debit`;

    await runPreReviewPipeline({
      file: createCSVFile(csv2, 'second.csv'),
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'test-model',
      defaultCurrency: INR,
    });

    const saved = reviewSessionRepository.load();
    expect(saved!.fileName).toBe('second.csv');
    expect(saved!.transactions).toHaveLength(1);
  });

  it('passes sourceFileHash into saved session', async () => {
    const csv = `Date,Description,Amount,Type
20/10/2025,Salary,5000,credit`;

    await runPreReviewPipeline({
      file: createCSVFile(csv),
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'test-model',
      defaultCurrency: INR,
      sourceFileHash: 'abc123',
    });

    const saved = reviewSessionRepository.load();
    expect(saved!.sourceMetadata?.sourceFileHash).toBe('abc123');
  });

  it('invokes onProgress callback', async () => {
    const csv = `Date,Description,Amount,Type
20/10/2025,Salary,5000,credit`;

    const progress: string[] = [];
    await runPreReviewPipeline({
      file: createCSVFile(csv),
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'test-model',
      defaultCurrency: INR,
      onProgress: (msg) => progress.push(msg),
    });

    expect(progress).toContain('Categorizing transactions...');
    // CSV also triggers "Parsing CSV..." from extractStatementBundleFromFile
    expect(progress.length).toBeGreaterThan(1);
  });

  it('throws when no model provided (model falls back to empty string)', async () => {
    const csv = `Date,Description,Amount,Type
20/10/2025,Salary,5000,credit`;

    await expect(
      runPreReviewPipeline({
        file: createCSVFile(csv),
        provider: 'ollama',
        baseUrl: 'http://localhost:11434',
        defaultCurrency: INR,
      }),
    ).rejects.toThrow('model');
  });

  it('passes statementType through to extraction', async () => {
    const csv = `Date,Description,Amount,Type
20/10/2025,Salary,5000,credit`;

    const result = await runPreReviewPipeline({
      file: createCSVFile(csv),
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'test-model',
      defaultCurrency: INR,
      statementType: 'credit_card',
    });

    // statementType is passed through — CSV parser preserves it
    expect(result.statementType).toBe('credit_card');
  });

  it('has no verificationReport for CSV (no verification inputs)', async () => {
    const csv = `Date,Description,Amount,Type
20/10/2025,Salary,5000,credit`;

    const result = await runPreReviewPipeline({
      file: createCSVFile(csv),
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'test-model',
      defaultCurrency: INR,
    });

    // CSV parser sets verificationInputs to undefined → attachVerificationToExtractionBundle is a no-op
    expect(result.verificationReport).toBeUndefined();
  });

  it('has null statementSummary for CSV', async () => {
    const csv = `Date,Description,Amount,Type
20/10/2025,Salary,5000,credit`;

    const result = await runPreReviewPipeline({
      file: createCSVFile(csv),
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'test-model',
      defaultCurrency: INR,
    });

    expect(result.statementSummary).toBeNull();
  });

  it('categorizes transactions via keyword fallback when LLM is unavailable', async () => {
    // fetch rejects → runCategorizationCore falls back to categorizeByKeywords
    const csv = `Date,Description,Amount,Type
20/10/2025,AMAZON PURCHASE,250,debit`;

    const result = await runPreReviewPipeline({
      file: createCSVFile(csv),
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'test-model',
      defaultCurrency: INR,
    });

    const tx = result.transactions[0];
    expect(tx.category.id).toBe('shopping');
    expect(tx.categoryConfidence).toBe(0.3);
    expect(tx.needsReview).toBe(true);
  });

  it('creates sourceMetadata object even without sourceFileHash', async () => {
    const csv = `Date,Description,Amount,Type
20/10/2025,Salary,5000,credit`;

    const result = await runPreReviewPipeline({
      file: createCSVFile(csv),
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'test-model',
      defaultCurrency: INR,
    });

    // Pipeline always constructs sourceMetadata, but hash is undefined when not provided
    expect(result.sourceMetadata).toBeDefined();
    expect(result.sourceMetadata!.sourceFileHash).toBeUndefined();
  });

  it('passes isDuplicateImport into saved session sourceMetadata', async () => {
    const csv = `Date,Description,Amount,Type
20/10/2025,Salary,5000,credit`;

    await runPreReviewPipeline({
      file: createCSVFile(csv),
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'test-model',
      defaultCurrency: INR,
      sourceFileHash: 'hash123',
      isDuplicateImport: true,
    });

    const saved = reviewSessionRepository.load();
    expect(saved!.sourceMetadata?.isDuplicateImport).toBe(true);
  });

  it('does not set isDuplicateImport when not provided', async () => {
    const csv = `Date,Description,Amount,Type
20/10/2025,Salary,5000,credit`;

    await runPreReviewPipeline({
      file: createCSVFile(csv),
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'test-model',
      defaultCurrency: INR,
      sourceFileHash: 'hash123',
    });

    const saved = reviewSessionRepository.load();
    expect(saved!.sourceMetadata?.isDuplicateImport).toBeUndefined();
  });
});
