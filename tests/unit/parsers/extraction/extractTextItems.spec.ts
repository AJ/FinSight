import { describe, it, expect } from 'vitest';
import { PDFPasswordError, PASSWORD_REASON, isPasswordError } from '@/lib/parsers/extraction/extractTextItems';

describe('PDFPasswordError', () => {
  it('creates error with correct name and code', () => {
    const err = new PDFPasswordError('test', PASSWORD_REASON.NEED_PASSWORD);
    expect(err.name).toBe('PDFPasswordError');
    expect(err.code).toBe(1);
    expect(err.message).toBe('test');
  });

  it('uses default message', () => {
    const err = new PDFPasswordError();
    expect(err.message).toBe('PDF is password protected');
  });
});

describe('isPasswordError', () => {
  it('recognizes PDFPasswordError instances', () => {
    expect(isPasswordError(new PDFPasswordError())).toBe(true);
  });

  it('recognizes PasswordException name', () => {
    const err = { name: 'PasswordException', message: 'pwd needed' };
    expect(isPasswordError(err)).toBe(true);
  });

  it('recognizes password in message', () => {
    expect(isPasswordError(new Error('PDF requires a password'))).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isPasswordError(new Error('Network error'))).toBe(false);
    expect(isPasswordError(null)).toBe(false);
    expect(isPasswordError(undefined)).toBe(false);
  });
});
