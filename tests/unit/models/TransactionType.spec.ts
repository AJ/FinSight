import { describe, it, expect, vi } from 'vitest';
import {
  TransactionType,
  normalizeTransactionType,
  normalizeTransactionTypeStrict,
} from '@/models/TransactionType';

describe('normalizeTransactionType', () => {
  it('returns Credit for "credit"', () => {
    expect(normalizeTransactionType('credit')).toBe(TransactionType.Credit);
  });

  it('returns Credit for "income" (legacy alias)', () => {
    expect(normalizeTransactionType('income')).toBe(TransactionType.Credit);
  });

  it('returns Debit for "debit"', () => {
    expect(normalizeTransactionType('debit')).toBe(TransactionType.Debit);
  });

  it('returns Debit for "expense" (legacy alias)', () => {
    expect(normalizeTransactionType('expense')).toBe(TransactionType.Debit);
  });

  it('is case-insensitive', () => {
    expect(normalizeTransactionType('CREDIT')).toBe(TransactionType.Credit);
    expect(normalizeTransactionType('Income')).toBe(TransactionType.Credit);
    expect(normalizeTransactionType('DEBIT')).toBe(TransactionType.Debit);
    expect(normalizeTransactionType('Expense')).toBe(TransactionType.Debit);
  });

  it('trims whitespace', () => {
    expect(normalizeTransactionType(' credit ')).toBe(TransactionType.Credit);
    expect(normalizeTransactionType('\tdebit\n')).toBe(TransactionType.Debit);
  });

  it('returns null for null', () => {
    expect(normalizeTransactionType(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(normalizeTransactionType(undefined)).toBeNull();
  });

  it('returns null for invalid string and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(normalizeTransactionType('invalid')).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Invalid type'));

    warn.mockRestore();
  });

  it('returns null for number input', () => {
    expect(normalizeTransactionType(123)).toBeNull();
  });

  it('returns null for object input', () => {
    expect(normalizeTransactionType({})).toBeNull();
  });
});

describe('normalizeTransactionTypeStrict', () => {
  it('returns Credit for valid input', () => {
    expect(normalizeTransactionTypeStrict('credit')).toBe(TransactionType.Credit);
  });

  it('returns Debit for valid input', () => {
    expect(normalizeTransactionTypeStrict('debit')).toBe(TransactionType.Debit);
  });

  it('throws on invalid input', () => {
    expect(() => normalizeTransactionTypeStrict('invalid')).toThrow(
      'Invalid transaction type',
    );
  });

  it('throws on null', () => {
    expect(() => normalizeTransactionTypeStrict(null)).toThrow(
      'Invalid transaction type',
    );
  });
});
