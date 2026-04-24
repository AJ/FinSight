import { describe, it, expect } from 'vitest';
import {
  isPasswordError,
  PASSWORD_REASON,
  PDFPasswordError,
} from '@/lib/parsers/documentExtraction';

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
