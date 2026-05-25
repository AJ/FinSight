import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractStatementBundleFromFile, extractStatementBundleFromRawText } from '@/lib/parsers/extractStatementBundle';
import { extractTextFromPDF } from '@/lib/parsers/documentExtraction';
import { parseCSV } from '@/lib/parsers/csvParser';
import { parseXLS } from '@/lib/parsers/xlsParser';
import { processStatement } from '@/lib/parsers/pipeline';

vi.mock('@/lib/parsers/documentExtraction', () => ({
  extractTextFromPDF: vi.fn(),
}));

vi.mock('@/lib/parsers/csvParser', () => ({
  parseCSV: vi.fn(),
}));

vi.mock('@/lib/parsers/xlsParser', () => ({
  parseXLS: vi.fn(),
}));

vi.mock('@/lib/parsers/pipeline', () => ({
  processStatement: vi.fn(),
}));

const mockExtractText = vi.mocked(extractTextFromPDF);
const mockParseCSV = vi.mocked(parseCSV);
const mockParseXLS = vi.mocked(parseXLS);
const mockProcessStatement = vi.mocked(processStatement);

const mockBundle: import('@/lib/parsers/contracts').ExtractionBundle = {
  statementType: 'bank' as const,
  transactions: [],
  currency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
  format: 'csv',
  fileName: 'test.csv',
  parseDate: new Date(),
  statementSummary: null,
  verificationInputs: undefined,
  warnings: [],
  errors: [],
  parsingErrors: [],
  rawText: 'test',
};

function makeFile(name: string): File {
  return new File(['content'], name, { type: 'application/octet-stream' });
}

const INR = { code: 'INR', symbol: '₹', name: 'Indian Rupee' };
const llmConfig = { provider: 'ollama' as const, baseUrl: 'http://localhost:11434', model: 'test' };

describe('extractStatementBundleFromFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when PDF file has no llmConfig', async () => {
    await expect(
      extractStatementBundleFromFile({ file: makeFile('stmt.pdf'), defaultCurrency: INR }),
    ).rejects.toThrow('LLM runtime configuration is required');
  });

  it('throws when PDF has no extractable text', async () => {
    mockExtractText.mockResolvedValueOnce('   ');
    await expect(
      extractStatementBundleFromFile({ file: makeFile('stmt.pdf'), defaultCurrency: INR, llmConfig }),
    ).rejects.toThrow('No text found in file');
  });

  it('delegates PDF to pipeline via extractStatementBundleFromRawText', async () => {
    mockExtractText.mockResolvedValueOnce('some bank text');
    mockProcessStatement.mockResolvedValueOnce({ success: true, data: mockBundle, warnings: [], errors: [] });
    const result = await extractStatementBundleFromFile({
      file: makeFile('stmt.pdf'), defaultCurrency: INR, llmConfig,
    });
    expect(result).toBe(mockBundle);
    expect(mockExtractText).toHaveBeenCalledOnce();
  });

  it('delegates CSV to parseCSV', async () => {
    mockParseCSV.mockResolvedValueOnce(mockBundle);
    const result = await extractStatementBundleFromFile({
      file: makeFile('stmt.csv'), defaultCurrency: INR,
    });
    expect(result).toBe(mockBundle);
    expect(mockParseCSV).toHaveBeenCalledOnce();
  });

  it('delegates XLS to parseXLS', async () => {
    mockParseXLS.mockResolvedValueOnce(mockBundle);
    const result = await extractStatementBundleFromFile({
      file: makeFile('stmt.xls'), defaultCurrency: INR,
    });
    expect(result).toBe(mockBundle);
    expect(mockParseXLS).toHaveBeenCalledOnce();
  });

  it('delegates XLSX to parseXLS', async () => {
    mockParseXLS.mockResolvedValueOnce(mockBundle);
    const result = await extractStatementBundleFromFile({
      file: makeFile('stmt.xlsx'), defaultCurrency: INR,
    });
    expect(result).toBe(mockBundle);
  });

  it('throws for unsupported file formats', async () => {
    await expect(
      extractStatementBundleFromFile({ file: makeFile('stmt.txt'), defaultCurrency: INR }),
    ).rejects.toThrow('Unsupported file format');
  });

  it('calls onProgress for PDF extraction stages', async () => {
    mockExtractText.mockResolvedValueOnce('bank text');
    mockProcessStatement.mockResolvedValueOnce({ success: true, data: mockBundle, warnings: [], errors: [] });
    const onProgress = vi.fn();
    await extractStatementBundleFromFile({
      file: makeFile('stmt.pdf'), defaultCurrency: INR, llmConfig, onProgress,
    });
    expect(onProgress).toHaveBeenCalledWith('Extracting text from document...');
    expect(onProgress).toHaveBeenCalledWith('Parsing statement...');
  });

  it('calls onProgress for CSV parsing', async () => {
    mockParseCSV.mockResolvedValueOnce(mockBundle);
    const onProgress = vi.fn();
    await extractStatementBundleFromFile({
      file: makeFile('stmt.csv'), defaultCurrency: INR, onProgress,
    });
    expect(onProgress).toHaveBeenCalledWith('Parsing CSV...');
  });

  it('calls onProgress for XLS parsing', async () => {
    mockParseXLS.mockResolvedValueOnce(mockBundle);
    const onProgress = vi.fn();
    await extractStatementBundleFromFile({
      file: makeFile('stmt.xls'), defaultCurrency: INR, onProgress,
    });
    expect(onProgress).toHaveBeenCalledWith('Parsing Excel file...');
  });
});

describe('extractStatementBundleFromRawText error path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when pipeline returns success:false', async () => {
    mockProcessStatement.mockResolvedValueOnce({
      success: false,
      data: null,
      warnings: [],
      errors: ['Schema validation failed', 'Amount missing'],
    });
    await expect(
      extractStatementBundleFromRawText({
        rawText: 'bad text',
        defaultCurrency: INR,
        fileName: 'test.pdf',
        format: 'pdf',
        llmConfig,
      }),
    ).rejects.toThrow('Pipeline failed: Schema validation failed, Amount missing');
  });
});
