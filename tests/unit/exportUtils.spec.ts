import { describe, it, expect, vi, beforeEach } from 'vitest';

import { exportTransactionsToCSV, exportDebugLog } from '@/lib/exportUtils';
import { makeTransaction } from '@tests/unit/factories';

// Mock DOM APIs
const mockClick = vi.fn();
const mockAppendChild = vi.fn();
const mockRemoveChild = vi.fn();

// Capture Blob constructor args
let capturedBlobContent: string | null = null;

class MockBlob {
  content: unknown;
  options: unknown;
  constructor(content: unknown, options?: unknown) {
    this.content = content;
    this.options = options;
    capturedBlobContent = Array.isArray(content) ? (content[0] as string) ?? null : null;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedBlobContent = null;
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:mock-url'),
    revokeObjectURL: vi.fn(),
  });
  const anchor = document.createElement('a');
  vi.spyOn(anchor, 'click').mockImplementation(mockClick);
  vi.spyOn(anchor, 'setAttribute');
  vi.spyOn(document, 'createElement').mockReturnValue(anchor);
  vi.spyOn(document.body, 'appendChild').mockImplementation(mockAppendChild);
  vi.spyOn(document.body, 'removeChild').mockImplementation(mockRemoveChild);
  vi.stubGlobal('alert', vi.fn());
  vi.stubGlobal('Blob', MockBlob);
});

describe('exportTransactionsToCSV', () => {
  it('shows alert when no transactions', () => {
    exportTransactionsToCSV([]);
    expect(alert).toHaveBeenCalledWith('No transactions to export!');
    expect(capturedBlobContent).toBeNull();
  });

  it('creates CSV with correct header', () => {
    const txn = makeTransaction({ description: 'Test', amount: 100, type: 'debit' });
    exportTransactionsToCSV([txn]);

    const lines = capturedBlobContent!.split('\n');
    expect(lines[0]).toBe('Date,Description,Amount,Type,Category,Merchant');
  });

  it('creates CSV row for each transaction', () => {
    const txns = [
      makeTransaction({ id: 't1', description: 'Amazon', amount: -500 }),
      makeTransaction({ id: 't2', description: 'Flipkart', amount: -200 }),
    ];
    exportTransactionsToCSV(txns);

    const lines = capturedBlobContent!.split('\n');
    expect(lines).toHaveLength(3);
  });

  it('escapes double quotes in description', () => {
    const txn = makeTransaction({ description: 'He said "hello"' });
    exportTransactionsToCSV([txn]);

    expect(capturedBlobContent!).toContain('""hello""');
  });

  it('handles empty merchant field', () => {
    const txn = makeTransaction({ merchant: '' });
    exportTransactionsToCSV([txn]);

    const lines = capturedBlobContent!.split('\n');
    const fields = lines[1].split(',');
    expect(fields.length).toBeGreaterThanOrEqual(6);
  });

  it('triggers download via DOM link', () => {
    exportTransactionsToCSV([makeTransaction()]);
    expect(mockClick).toHaveBeenCalled();
    expect(mockAppendChild).toHaveBeenCalled();
    expect(mockRemoveChild).toHaveBeenCalled();
  });
});

describe('exportDebugLog', () => {
  it('creates debug log with extracted text', () => {
    exportDebugLog('raw PDF text here', [makeTransaction()]);

    expect(capturedBlobContent!).toContain('raw PDF text here');
    expect(capturedBlobContent!).toContain('PDF PARSING DEBUG LOG');
  });

  it('includes transaction details in debug log', () => {
    const txn = makeTransaction({ description: 'TestPurchase', amount: 999 });
    exportDebugLog('text', [txn]);

    expect(capturedBlobContent!).toContain('TestPurchase');
    expect(capturedBlobContent!).toContain('999');
    expect(capturedBlobContent!).toContain('Transaction 1:');
  });

  it('triggers download via DOM link', () => {
    exportDebugLog('text', []);
    expect(mockClick).toHaveBeenCalled();
  });

  it('handles empty transactions array', () => {
    exportDebugLog('text only', []);

    expect(capturedBlobContent!).toContain('text only');
    expect(capturedBlobContent!).toContain('PARSED TRANSACTIONS (0)');
  });
});
