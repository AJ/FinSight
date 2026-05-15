import { describe, it, expect } from 'vitest';
import { parseFormAmount, parseFormDate } from '@/components/review/reviewEditDialogCompanion';

describe('parseFormAmount', () => {
  it('parses valid number string', () => {
    expect(parseFormAmount('42.5')).toBe(42.5);
  });

  it('returns null for empty string', () => {
    expect(parseFormAmount('')).toBeNull();
  });

  it('returns null for non-numeric string', () => {
    expect(parseFormAmount('abc')).toBeNull();
  });

  it('handles negative numbers', () => {
    expect(parseFormAmount('-100')).toBe(-100);
  });
});

describe('parseFormDate', () => {
  it('parses valid date string', () => {
    const result = parseFormDate('2026-01-15');
    expect(result).toBeInstanceOf(Date);
    expect(result!.getFullYear()).toBe(2026);
    expect(result!.getMonth()).toBe(0);
    expect(result!.getDate()).toBe(15);
  });

  it('returns null for empty string', () => {
    expect(parseFormDate('')).toBeNull();
  });

  it('returns null for invalid date string', () => {
    expect(parseFormDate('not-a-date')).toBeNull();
  });
});
