import { describe, it, expect } from 'vitest';
import {
  handlePasswordRetryResult,
  classifyProcessingError,
  isAutoDetectAvailable,
  resolveDuplicateStatementType,
  formatProcessingSuccess,
} from '@/components/upload/fileProcessorCompanions';
import { SourceType } from '@/models/SourceType';

describe('handlePasswordRetryResult', () => {
  it('returns remaining attempts on first failure', () => {
    const result = handlePasswordRetryResult(0);
    expect(result.maxReached).toBe(false);
    expect(result.remaining).toBe(2);
  });

  it('returns remaining=1 on second failure', () => {
    const result = handlePasswordRetryResult(1);
    expect(result.maxReached).toBe(false);
    expect(result.remaining).toBe(1);
  });

  it('returns maxReached=true at max attempts', () => {
    const result = handlePasswordRetryResult(2);
    expect(result.maxReached).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it('respects custom maxAttempts', () => {
    const result = handlePasswordRetryResult(3, 5);
    expect(result.maxReached).toBe(false);
    expect(result.remaining).toBe(1);
  });
});

describe('classifyProcessingError', () => {
  it('returns cancelled when wasCancelled is true', () => {
    expect(classifyProcessingError(new Error('boom'), true)).toBe('cancelled');
  });

  it('extracts message from Error instances', () => {
    expect(classifyProcessingError(new Error('network timeout'), false)).toBe('network timeout');
  });

  it('returns default message for non-Error values', () => {
    expect(classifyProcessingError('string error', false)).toBe('Failed to process file');
    expect(classifyProcessingError(null, false)).toBe('Failed to process file');
  });
});

describe('isAutoDetectAvailable', () => {
  it('returns true for PDF files', () => {
    expect(isAutoDetectAvailable('statement.pdf')).toBe(true);
  });

  it('returns false for CSV files', () => {
    expect(isAutoDetectAvailable('statement.csv')).toBe(false);
  });

  it('returns false for XLSX files', () => {
    expect(isAutoDetectAvailable('statement.xlsx')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isAutoDetectAvailable(null)).toBe(false);
  });
});

describe('resolveDuplicateStatementType', () => {
  it('maps CreditCard to credit_card', () => {
    expect(resolveDuplicateStatementType(SourceType.CreditCard)).toBe('credit_card');
  });

  it('maps Bank to bank', () => {
    expect(resolveDuplicateStatementType(SourceType.Bank)).toBe('bank');
  });
});

describe('formatProcessingSuccess', () => {
  it('formats singular transaction', () => {
    expect(formatProcessingSuccess(1)).toBe('1 transaction');
  });

  it('formats plural transactions', () => {
    expect(formatProcessingSuccess(5)).toBe('5 transactions');
  });

  it('includes currency when provided', () => {
    expect(formatProcessingSuccess(3, 'INR')).toBe('3 transactions (INR)');
  });

  it('formats singular with currency', () => {
    expect(formatProcessingSuccess(1, 'USD')).toBe('1 transaction (USD)');
  });
});
