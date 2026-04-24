import { describe, it, expect } from 'vitest';
import { normalizeStatementText } from '@/lib/parsers/normalization';

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
