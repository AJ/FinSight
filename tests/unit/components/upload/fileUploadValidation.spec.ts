import { describe, it, expect } from 'vitest';
import {
  MAX_FILE_SIZE,
  VALID_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  getFileExtension,
  validateFile,
  isAbortError,
  formatElapsedSeconds,
} from '@/components/upload/fileUploadValidation';

function mockFile(name: string, type = '', size = 1024) {
  return { name, type, size };
}

describe('getFileExtension', () => {
  it('extracts lowercase extension', () => {
    expect(getFileExtension('Statement.PDF')).toBe('.pdf');
  });

  it('handles already lowercase', () => {
    expect(getFileExtension('report.csv')).toBe('.csv');
  });

  it('handles double extensions', () => {
    expect(getFileExtension('archive.tar.gz')).toBe('.gz');
  });

  it('handles no extension', () => {
    expect(getFileExtension('README')).toBe('readme');
  });

  it('handles hidden files with no extension', () => {
    expect(getFileExtension('.gitignore')).toBe('.gitignore');
  });
});

describe('validateFile', () => {
  it('accepts a valid CSV', () => {
    const result = validateFile(mockFile('data.csv', 'text/csv'));
    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
  });

  it('accepts a valid PDF', () => {
    const result = validateFile(mockFile('stmt.pdf', 'application/pdf'));
    expect(result.valid).toBe(true);
  });

  it('accepts a valid XLSX', () => {
    const result = validateFile(mockFile('data.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
    expect(result.valid).toBe(true);
  });

  it('accepts a valid XLS', () => {
    const result = validateFile(mockFile('data.xls', 'application/vnd.ms-excel'));
    expect(result.valid).toBe(true);
  });

  it('accepts file with empty MIME type (browser may omit it)', () => {
    const result = validateFile(mockFile('data.csv', ''));
    expect(result.valid).toBe(true);
  });

  it('rejects unsupported extension', () => {
    const result = validateFile(mockFile('photo.jpg', 'image/jpeg'));
    expect(result.valid).toBe(false);
    expect(result.error).toContain('valid file');
  });

  it('rejects MIME type mismatch', () => {
    const result = validateFile(mockFile('data.csv', 'image/png'));
    expect(result.valid).toBe(false);
    expect(result.error).toContain('does not match');
  });

  it('rejects file exceeding size limit', () => {
    const result = validateFile(mockFile('big.pdf', 'application/pdf', MAX_FILE_SIZE + 1));
    expect(result.valid).toBe(false);
    expect(result.error).toContain('too large');
  });

  it('accepts file at exactly size limit', () => {
    const result = validateFile(mockFile('exact.pdf', 'application/pdf', MAX_FILE_SIZE));
    expect(result.valid).toBe(true);
  });

  it('handles case-insensitive extension', () => {
    const result = validateFile(mockFile('DATA.CSV', 'text/csv'));
    expect(result.valid).toBe(true);
  });

  it('accepts text/plain as valid CSV MIME', () => {
    const result = validateFile(mockFile('export.csv', 'text/plain'));
    expect(result.valid).toBe(true);
  });
});

describe('isAbortError', () => {
  it('recognizes DOMException AbortError', () => {
    const err = new DOMException('The operation was aborted', 'AbortError');
    expect(isAbortError(err)).toBe(true);
  });

  it('recognizes error with name AbortError', () => {
    expect(isAbortError({ name: 'AbortError', message: 'aborted' })).toBe(true);
  });

  it('recognizes cancelled (British spelling) in message', () => {
    expect(isAbortError({ name: 'Error', message: 'Request cancelled' })).toBe(true);
  });

  it('recognizes canceled (American spelling) in message', () => {
    expect(isAbortError({ name: 'Error', message: 'Request canceled' })).toBe(true);
  });

  it('recognizes case-insensitive cancellation', () => {
    expect(isAbortError({ name: 'Error', message: 'CANCELLED BY USER' })).toBe(true);
  });

  it('returns false for null', () => {
    expect(isAbortError(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isAbortError(undefined)).toBe(false);
  });

  it('returns false for non-abort error', () => {
    expect(isAbortError(new Error('Network timeout'))).toBe(false);
  });

  it('returns false for string', () => {
    expect(isAbortError('something')).toBe(false);
  });

  it('returns false for object without abort indicators', () => {
    expect(isAbortError({ name: 'TypeError', message: 'not a function' })).toBe(false);
  });
});

describe('formatElapsedSeconds', () => {
  it('computes elapsed time in seconds', () => {
    const result = formatElapsedSeconds(1000, 3500);
    expect(result).toBe('2.50');
  });

  it('returns 0.00 when times are equal', () => {
    expect(formatElapsedSeconds(1000, 1000)).toBe('0.00');
  });

  it('uses Date.now when no reference provided', () => {
    const start = Date.now() - 1500;
    const result = formatElapsedSeconds(start);
    expect(parseFloat(result)).toBeCloseTo(1.5, 1);
  });
});

describe('constants', () => {
  it('MAX_FILE_SIZE is 10 MB', () => {
    expect(MAX_FILE_SIZE).toBe(10 * 1024 * 1024);
  });

  it('VALID_EXTENSIONS contains the four supported types', () => {
    expect(VALID_EXTENSIONS).toEqual(['.csv', '.pdf', '.xls', '.xlsx']);
  });

  it('ALLOWED_MIME_TYPES has entries for every valid extension', () => {
    for (const ext of VALID_EXTENSIONS) {
      expect(ALLOWED_MIME_TYPES[ext]).toBeDefined();
      expect(ALLOWED_MIME_TYPES[ext].length).toBeGreaterThan(0);
    }
  });
});
