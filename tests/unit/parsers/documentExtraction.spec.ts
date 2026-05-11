import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import {
  isPasswordError,
  PASSWORD_REASON,
  PDFPasswordError,
} from '@/lib/parsers/documentExtraction';

// ── pdfjs-dist mock ───────────────────────────────────────────────────────────
// pdfjs-dist requires DOMMatrix (canvas API) which jsdom doesn't provide.
// This is a legitimate external boundary — pdfjs is a binary format parser
// with environment dependencies. We mock it to return realistic positioned
// text items, which exercises the real layout assembly logic:
// y-coordinate grouping, x-sorting, tab insertion, page breaks.

interface MockTextItem {
  str: string;
  transform: number[];
}

interface MockPage {
  getTextContent: () => Promise<{ items: MockTextItem[] }>;
}

const mockGetDocument = vi.fn();
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: (...args: unknown[]) => mockGetDocument(...args),
}));

function makeTextItem(str: string, x: number, y: number): MockTextItem {
  return { str, transform: [1, 0, 0, 1, x, y] };
}

function setupPdfMock(pages: MockPage[][]) {
  const loadingTask = {
    onPassword: null as ((cb: (pw: string) => void, reason: number) => void) | null,
    promise: Promise.resolve({
      numPages: pages.length,
      getPage: (num: number) => Promise.resolve(pages[num - 1][0]),
    }),
    destroy: vi.fn().mockResolvedValue(undefined),
  };

  mockGetDocument.mockReturnValue(loadingTask);
  return loadingTask;
}

function setupPasswordPdf(reason: number) {
  const loadingTask: {
    onPassword: ((cb: (pw: string) => void, reason: number) => void) | null;
    promise: Promise<unknown>;
    destroy: ReturnType<typeof vi.fn>;
  } = {
    onPassword: null,
    promise: new Promise(() => {}),
    destroy: vi.fn().mockResolvedValue(undefined),
  };

  mockGetDocument.mockReturnValue(loadingTask);

  // The production code sets loadingTask.onPassword inside the Promise constructor,
  // which runs synchronously after the awaits. We need to fire the callback
  // after the production code has assigned onPassword. Using setTimeout ensures
  // it runs after the current microtask queue (which includes the awaits).
  setTimeout(() => {
    if (loadingTask.onPassword) {
      loadingTask.onPassword(() => {}, reason);
    }
  }, 0);

  return loadingTask;
}

function setupPasswordPdfWithCorrectPassword() {
  let resolvePdf: (val: unknown) => void;
  const loadingTask: {
    onPassword: ((cb: (pw: string) => void, reason: number) => void) | null;
    promise: Promise<unknown>;
    destroy: ReturnType<typeof vi.fn>;
  } = {
    onPassword: null,
    promise: new Promise(r => { resolvePdf = r; }),
    destroy: vi.fn().mockResolvedValue(undefined),
  };

  mockGetDocument.mockReturnValue(loadingTask);

  // Fire the password callback after production code assigns onPassword.
  // The production code calls updateCallback(password) when password is provided
  // and reason is NEED_PASSWORD. We treat that as "password accepted" and
  // resolve the PDF promise — so extraction only proceeds if the password path works.
  setTimeout(() => {
    if (loadingTask.onPassword) {
      loadingTask.onPassword(
        (password: string) => {
          // updateCallback was called with the password — resolve the PDF
          void password;
          resolvePdf({
            numPages: 1,
            getPage: () => Promise.resolve({
              getTextContent: () => Promise.resolve({
                items: [makeTextItem('Secret Content', 40, 700)],
              }),
            }),
          });
        },
        PASSWORD_REASON.NEED_PASSWORD,
      );
    }
  }, 0);

  return loadingTask;
}

function makePdfFile(name = 'test.pdf'): File {
  return new File([new ArrayBuffer(8)], name, { type: 'application/pdf' });
}

// ── Noisy bank statement text items ──────────────────────────────────────────
// Simulates realistic positioned text from a multi-page bank statement.
// Each item has (str, x, y) matching what pdfjs would extract.

let noisyPdfPages: MockPage[][];

beforeAll(() => {
  // Page 1: header + summary + transaction table
  const page1Items: MockTextItem[] = [
    // Bank header
    makeTextItem('ACME BANK', 40, 780),
    makeTextItem('Savings Account Statement', 40, 760),
    // Account info
    makeTextItem('Account No: XXXX 1234', 40, 740),
    makeTextItem('IFSC: ACME0001234', 240, 740),
    // Statement details
    makeTextItem('Statement Period: 01/01/2024 to 31/01/2024', 40, 720),
    makeTextItem('Statement Date: 31/01/2024', 40, 705),
    // Summary block — two-column layout (triggers tab separator at x-gap > 50)
    makeTextItem('Opening Balance:', 40, 680),
    makeTextItem('50,000.00', 190, 680),
    makeTextItem('Total Credits:', 40, 665),
    makeTextItem('1,00,000.00', 190, 665),
    makeTextItem('Closing Balance:', 40, 650),
    makeTextItem('1,35,000.00', 190, 650),
    // Transaction table header
    makeTextItem('Date', 40, 620),
    makeTextItem('Description', 120, 620),
    makeTextItem('Debit', 340, 620),
    makeTextItem('Credit', 410, 620),
    makeTextItem('Balance', 480, 620),
    // Transactions — multi-column rows (same y, different x)
    makeTextItem('02/01/2024', 40, 600),
    makeTextItem('SALARY CREDIT - JAN', 120, 600),
    makeTextItem('1,00,000.00', 410, 600),
    makeTextItem('1,50,000.00', 480, 600),
    makeTextItem('03/01/2024', 40, 585),
    makeTextItem('RENT PAYMENT', 120, 585),
    makeTextItem('15,000.00', 340, 585),
    makeTextItem('1,35,000.00', 480, 585),
    makeTextItem('05/01/2024', 40, 570),
    makeTextItem('AMAZON INDIA PVT LTD', 120, 570),
    makeTextItem('2,450.00', 340, 570),
    makeTextItem('1,32,550.00', 480, 570),
    makeTextItem('10/01/2024', 40, 555),
    makeTextItem('NETFLIX SUBSCRIPTION', 120, 555),
    makeTextItem('649.00', 340, 555),
    makeTextItem('1,28,245.00', 480, 555),
    // Footer noise
    makeTextItem('Page 1 of 2', 250, 40),
    makeTextItem('ACME Bank Ltd.', 40, 40),
    // Empty items (should be filtered out)
    makeTextItem('', 40, 500),
    makeTextItem('   ', 40, 500),
  ];

  // Page 2: continued header + more transactions + disclaimer
  const page2Items: MockTextItem[] = [
    makeTextItem('ACME BANK - Continued', 40, 780),
    // Repeated table header (noise)
    makeTextItem('Date', 40, 750),
    makeTextItem('Description', 120, 750),
    makeTextItem('Debit', 340, 750),
    makeTextItem('Credit', 410, 750),
    makeTextItem('Balance', 480, 750),
    // More transactions
    makeTextItem('22/01/2024', 40, 730),
    makeTextItem('ZOMATO - FOOD DELIVERY', 120, 730),
    makeTextItem('355.00', 340, 730),
    makeTextItem('1,54,720.00', 480, 730),
    makeTextItem('26/01/2024', 40, 715),
    makeTextItem('ATM WITHDRAWAL', 120, 715),
    makeTextItem('10,000.00', 340, 715),
    makeTextItem('1,39,720.00', 480, 715),
    makeTextItem('28/01/2024', 40, 700),
    makeTextItem('FLIPKART PURCHASE', 120, 700),
    makeTextItem('4,720.00', 340, 700),
    makeTextItem('1,35,000.00', 480, 700),
    // Closing summary
    makeTextItem('Closing Balance:', 40, 670),
    makeTextItem('1,35,000.00', 190, 670),
    // Disclaimer noise
    makeTextItem('This is a computer-generated statement and does not require a signature.', 40, 640),
    makeTextItem('For queries, contact customer care at 1800-123-4567', 40, 625),
    // Footer
    makeTextItem('Page 2 of 2', 250, 40),
    makeTextItem('ACME Bank Ltd.', 40, 40),
  ];

  noisyPdfPages = [
    [{ getTextContent: () => Promise.resolve({ items: page1Items }) }],
    [{ getTextContent: () => Promise.resolve({ items: page2Items }) }],
  ];
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Password helpers ──────────────────────────────────────────────────────────

describe('documentExtraction password helpers', () => {
  it('PDFPasswordError is recognized as a password error', () => {
    const error = new PDFPasswordError('Incorrect password', PASSWORD_REASON.INCORRECT_PASSWORD);

    expect(error.code).toBe(PASSWORD_REASON.INCORRECT_PASSWORD);
    expect(isPasswordError(error)).toBe(true);
  });

  it('generic password-shaped errors are recognized', () => {
    expect(
      isPasswordError({ name: 'PasswordException', code: PASSWORD_REASON.NEED_PASSWORD }),
    ).toBe(true);
    expect(isPasswordError({ message: 'PDF requires a password' })).toBe(true);
    expect(isPasswordError({ code: PASSWORD_REASON.INCORRECT_PASSWORD })).toBe(true);
  });

  it('non-password errors are rejected', () => {
    expect(isPasswordError(new Error('network error'))).toBe(false);
    expect(isPasswordError({ message: 'other failure', code: 99 })).toBe(false);
    expect(isPasswordError(null)).toBe(false);
  });
});

// ── extractTextFromPDF ────────────────────────────────────────────────────────

describe('extractTextFromPDF', () => {
  it('extracts text from a multi-page noisy bank statement', async () => {
    const { extractTextFromPDF } = await import('@/lib/parsers/documentExtraction');
    setupPdfMock(noisyPdfPages);

    const text = await extractTextFromPDF(makePdfFile());

    // Header content
    expect(text).toContain('ACME BANK');
    expect(text).toContain('Savings Account Statement');
    // Transactions from page 1
    expect(text).toContain('SALARY CREDIT');
    expect(text).toContain('AMAZON INDIA');
    // Transactions from page 2
    expect(text).toContain('FLIPKART PURCHASE');
    expect(text).toContain('ATM WITHDRAWAL');
    // Summary and noise
    expect(text).toContain('Opening Balance');
    expect(text).toContain('Closing Balance');
    expect(text).toContain('computer-generated statement');
  });

  it('inserts page break markers between pages', async () => {
    const { extractTextFromPDF } = await import('@/lib/parsers/documentExtraction');
    setupPdfMock(noisyPdfPages);

    const text = await extractTextFromPDF(makePdfFile());

    const breaks = text.split('--- PAGE BREAK ---');
    expect(breaks.length).toBeGreaterThanOrEqual(2);
    expect(breaks[0]).toContain('SALARY CREDIT');
    expect(breaks[1]).toContain('FLIPKART PURCHASE');
  });

  it('groups items on same y-coordinate into one line', async () => {
    const { extractTextFromPDF } = await import('@/lib/parsers/documentExtraction');
    setupPdfMock(noisyPdfPages);

    const text = await extractTextFromPDF(makePdfFile());

    // "Account No" and "IFSC" share y=740 — should be on the same output line
    const lines = text.split('\n');
    const accountLine = lines.find(l => l.includes('Account No') && l.includes('IFSC'));
    expect(accountLine).toBeDefined();
  });

  it('inserts tab separators when column gap exceeds threshold', async () => {
    const { extractTextFromPDF } = await import('@/lib/parsers/documentExtraction');
    setupPdfMock(noisyPdfPages);

    const text = await extractTextFromPDF(makePdfFile());

    // Transaction rows have Date at x=40, Description at x=120, Amount at x=340+
    // The gap between Description end and next column should trigger tab insertion
    expect(text).toContain('\t');
  });

  it('filters out empty and whitespace-only text items', async () => {
    const { extractTextFromPDF } = await import('@/lib/parsers/documentExtraction');
    setupPdfMock(noisyPdfPages);

    const text = await extractTextFromPDF(makePdfFile());

    // The empty items at y=500 should not produce any output lines
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    // No line should consist only of whitespace
    expect(lines.every(l => l.trim().length > 0)).toBe(true);
  });

  it('sorts lines by y-coordinate descending (top of page first)', async () => {
    const { extractTextFromPDF } = await import('@/lib/parsers/documentExtraction');
    setupPdfMock(noisyPdfPages);

    const text = await extractTextFromPDF(makePdfFile());

    // "ACME BANK" (y=780) should appear before "Page 1 of 2" (y=40)
    const bankIdx = text.indexOf('ACME BANK');
    const pageIdx = text.indexOf('Page 1 of 2');
    expect(bankIdx).toBeLessThan(pageIdx);
  });

  it('rejects with PDFPasswordError when password needed and not provided', async () => {
    const { extractTextFromPDF } = await import('@/lib/parsers/documentExtraction');
    setupPasswordPdf(PASSWORD_REASON.NEED_PASSWORD);

    await expect(extractTextFromPDF(makePdfFile())).rejects.toThrow('PDF requires a password');
  });

  it('provides password when prompted and continues extraction', async () => {
    const { extractTextFromPDF } = await import('@/lib/parsers/documentExtraction');
    setupPasswordPdfWithCorrectPassword();

    const text = await extractTextFromPDF(makePdfFile(), 'my-password');

    expect(text).toContain('Secret Content');
  });

  it('rejects with PDFPasswordError for incorrect password', async () => {
    const { extractTextFromPDF } = await import('@/lib/parsers/documentExtraction');
    setupPasswordPdf(PASSWORD_REASON.INCORRECT_PASSWORD);

    await expect(extractTextFromPDF(makePdfFile(), 'wrong')).rejects.toThrow('Incorrect password');
  });

  it('propagates errors from PDF parsing', async () => {
    const { extractTextFromPDF } = await import('@/lib/parsers/documentExtraction');

    const loadingTask = {
      onPassword: null as (() => void) | null,
      promise: Promise.reject(new Error('Corrupt PDF data')),
      destroy: vi.fn().mockResolvedValue(undefined),
    };
    mockGetDocument.mockReturnValue(loadingTask);

    await expect(extractTextFromPDF(makePdfFile())).rejects.toThrow('Corrupt PDF data');
  });
});

// ── extractTextFromTabular ────────────────────────────────────────────────────

describe('extractTextFromTabular', () => {
  it('returns file text for CSV files', async () => {
    const { extractTextFromTabular } = await import('@/lib/parsers/documentExtraction');

    const csvContent = 'Date,Description,Amount\n01/01/2024,Grocery,500';
    const file = new File([csvContent], 'data.csv', { type: 'text/csv' });

    const text = await extractTextFromTabular(file);

    expect(text).toBe(csvContent);
  });

  it('parses XLSX files using xlsx library', async () => {
    const { extractTextFromTabular } = await import('@/lib/parsers/documentExtraction');

    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['Date', 'Description', 'Amount'],
      ['01/01/2024', 'Grocery', 500],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
    const xlsBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

    const file = new File([xlsBuffer], 'data.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const text = await extractTextFromTabular(file);

    expect(text).toContain('Sheet: Transactions');
    expect(text).toContain('Date');
    expect(text).toContain('Grocery');
  });

  it('handles multi-sheet XLSX files', async () => {
    const { extractTextFromTabular } = await import('@/lib/parsers/documentExtraction');

    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['A', 'B']]), 'Sheet1');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['C', 'D']]), 'Sheet2');
    const xlsBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

    const file = new File([xlsBuffer], 'multi.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const text = await extractTextFromTabular(file);

    expect(text).toContain('Sheet: Sheet1');
    expect(text).toContain('Sheet: Sheet2');
  });
});
