import { describe, it, expect } from 'vitest';
import { buildSummaryPrompt } from '@/lib/parsers/extractSummary';

describe('buildSummaryPrompt', () => {
  it('returns CC summary prompt with bank context', () => {
    const result = buildSummaryPrompt('my raw text', 'credit_card', 'HDFC');
    expect(result).toContain('my raw text');
    expect(result).toContain('HDFC');
    expect(result).toContain('statementDate');
    expect(result).toContain('totalDue');
    expect(result.length).toBeGreaterThan(100);
  });

  it('returns bank summary prompt', () => {
    const result = buildSummaryPrompt('my raw text', 'bank', 'SBI');
    expect(result).toContain('my raw text');
    expect(result).toContain('openingBalance');
    expect(result).toContain('closingBalance');
    expect(result.length).toBeGreaterThan(100);
  });

  it('omits bank context when null', () => {
    const result = buildSummaryPrompt('my raw text', 'bank', null);
    expect(result).toContain('my raw text');
    expect(result).toContain('openingBalance');
  });

  it('replaces RAW_TEXT placeholder with actual text', () => {
    const input = 'Date,Desc,Amount\n01/01,AMAZON,1299';
    const result = buildSummaryPrompt(input, 'bank');
    expect(result).toContain('AMAZON');
    expect(result).toContain('1299');
  });
});
