import { describe, it, expect } from 'vitest';
import { normalizeStatementText, normalizeStatementWithLineMap } from '@/lib/parsers/normalization';

describe('normalizeStatementWithLineMap', () => {
  it('retains row identities across document-context currency cleanup and blank collapse', () => {
    const raw = '\nINR statement\n\n\nDate||Description||Amount\n2025-10-01||Merchant USD 30.54||C 700.79\n\n';
    expect(normalizeStatementWithLineMap(raw)).toEqual({
      text: 'INR statement\n\nDate||Description||Amount\n2025-10-01||Merchant $30.54||700.79',
      lineMap: [null, 0, null, null, 2, 3, null, null],
    });
  });

  it('does not join separate geometry rows while repairing numbers within a row', () => {
    const result = normalizeStatementWithLineMap('1,\n299.00\n1, 299 . 00');
    expect(result.text).toBe('1,\n299.00\n1,299.00');
    expect(result.lineMap).toEqual([0, 1, 2]);
  });

  it('maps stripped content to null without losing following rows', () => {
    expect(normalizeStatementWithLineMap('\u0000\n\u4e00\nDate\r\nMerchant\n')).toEqual({
      text: 'Date\nMerchant', lineMap: [null, null, 0, 1, null],
    });
  });
});

describe('normalizeStatementText', () => {
  it('normalizes unicode (non-breaking space)', () => {
    const result = normalizeStatementText('Amount\u00A01,299');
    expect(result).toContain('Amount');
    expect(result).toContain('1,299');
  });

  it('fixes broken numbers (comma split by newline)', () => {
    const result = normalizeStatementText('1,\n299.00');
    expect(result).toContain('1,299.00');
  });

  it('collapses multiple spaces', () => {
    const result = normalizeStatementText('AMAZON    IN    1299');
    expect(result).toBe('AMAZON IN 1299');
  });

  it('trims leading/trailing whitespace', () => {
    const result = normalizeStatementText('  text  \n\n  ');
    expect(result).toBe('text');
  });

  it('removes empty lines', () => {
    const result = normalizeStatementText('line1\n\n\nline2');
    expect(result).toBe('line1\n\nline2');
  });

  it('handles empty input', () => {
    const result = normalizeStatementText('');
    expect(result).toBe('');
  });

  it('preserves valid multi-line text', () => {
    const input = 'Date,Desc,Amount\n01/01,AMAZON,1299';
    const result = normalizeStatementText(input);
    expect(result).toBe('Date,Desc,Amount\n01/01,AMAZON,1299');
  });

  it('handles very long text without hanging', () => {
    const text = 'A'.repeat(50000);
    const result = normalizeStatementText(text);
    expect(result).toBe(text); // Single word should pass through unchanged
  });
});
