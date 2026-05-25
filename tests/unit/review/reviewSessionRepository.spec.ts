import { describe, it, expect, beforeEach } from 'vitest';
import { reviewSessionRepository } from '@/lib/review/reviewSessionRepository';
import { makeTransaction } from '@tests/unit/factories';

describe('reviewSessionRepository', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('save stores payload to sessionStorage', () => {
    const payload = {
      transactions: [makeTransaction({ id: '1' })],
      currency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
      format: 'csv' as const,
      statementType: 'bank' as const,
      fileName: 'test.csv',
      parseDate: new Date('2024-01-15'),
      statementSummary: null,
      warnings: [],
    };
    reviewSessionRepository.save(payload);
    const stored = sessionStorage.getItem('review-session-v1');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.transactions).toHaveLength(1);
  });

  it('load retrieves payload with Date objects rehydrated', () => {
    const payload = {
      transactions: [makeTransaction({ id: '1' })],
      currency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
      format: 'csv' as const,
      statementType: 'bank' as const,
      fileName: 'test.csv',
      parseDate: new Date('2024-01-15'),
      statementSummary: null,
      warnings: ['test warning'],
    };
    reviewSessionRepository.save(payload);
    const loaded = reviewSessionRepository.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.transactions).toHaveLength(1);
    expect(loaded!.parseDate).toEqual(new Date('2024-01-15'));
    expect(loaded!.warnings).toEqual(['test warning']);
  });

  it('load returns null for missing key', () => {
    expect(reviewSessionRepository.load()).toBeNull();
  });

  it('load returns null for corrupted JSON and clears the key', () => {
    sessionStorage.setItem('review-session-v1', 'not json');
    const result = reviewSessionRepository.load();
    expect(result).toBeNull();
    expect(sessionStorage.getItem('review-session-v1')).toBeNull();
  });

  it('clear removes the key', () => {
    reviewSessionRepository.save({
      transactions: [makeTransaction({ id: '1' })],
      currency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
      format: 'csv' as const,
      statementType: 'bank' as const,
      fileName: 'test.csv',
      parseDate: new Date('2024-01-15'),
      warnings: [],
    });
    reviewSessionRepository.clear();
    expect(sessionStorage.getItem('review-session-v1')).toBeNull();
  });

  it('clears legacy keys on save', () => {
    sessionStorage.setItem('pendingTransactions', '[]');
    sessionStorage.setItem('pendingVerificationReport', '{}');
    reviewSessionRepository.save({
      transactions: [makeTransaction({ id: '1' })],
      currency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
      format: 'csv' as const,
      statementType: 'bank' as const,
      fileName: 'test.csv',
      parseDate: new Date('2024-01-15'),
      warnings: [],
    });
    expect(sessionStorage.getItem('pendingTransactions')).toBeNull();
    expect(sessionStorage.getItem('pendingVerificationReport')).toBeNull();
  });

  it('clears legacy keys on load', () => {
    sessionStorage.setItem('pendingTransactions', '[]');
    sessionStorage.setItem('review-session-v1', JSON.stringify({
      transactions: [], currency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
      format: 'csv', statementType: 'bank', fileName: 'x', parseDate: '2024-01-15', warnings: [],
    }));
    reviewSessionRepository.load();
    expect(sessionStorage.getItem('pendingTransactions')).toBeNull();
  });

  it('handles sessionStorage unavailable gracefully', () => {
    const realSessionStorage = globalThis.sessionStorage;
    Object.defineProperty(globalThis, 'sessionStorage', { value: undefined, configurable: true });
    try {
      expect(reviewSessionRepository.load()).toBeNull();
      // save should not throw
      reviewSessionRepository.save({
        transactions: [makeTransaction({ id: '1' })],
        currency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
        format: 'csv' as const,
        statementType: 'bank' as const,
        fileName: 'test.csv',
        parseDate: new Date('2024-01-15'),
        warnings: [],
      });
      reviewSessionRepository.clear(); // Should not throw
    } finally {
      Object.defineProperty(globalThis, 'sessionStorage', { value: realSessionStorage, configurable: true });
    }
  });

  it('preserves sourceMetadata when round-tripping through save and load', () => {
    const payload = {
      transactions: [makeTransaction({ id: '1' })],
      currency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
      format: 'csv' as const,
      statementType: 'bank' as const,
      fileName: 'test.csv',
      parseDate: new Date('2024-01-15'),
      statementSummary: null,
      verificationReport: {
        verified: [],
        rejected: [],
        duplicates: [],
        reconciliation: { passed: true },
        overallConfidence: 0.95,
      },
      warnings: [],
      sourceMetadata: { sourceFileHash: 'abc123' },
    };
    reviewSessionRepository.save(payload);
    const loaded = reviewSessionRepository.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.sourceMetadata).toEqual({ sourceFileHash: 'abc123' });
    expect(loaded!.verificationReport).toEqual({
      verified: [],
      rejected: [],
      duplicates: [],
      reconciliation: { passed: true },
      overallConfidence: 0.95,
    });
  });
});
