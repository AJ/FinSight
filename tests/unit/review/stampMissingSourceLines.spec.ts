import { describe, it, expect } from 'vitest';
import { stampMissingSourceLines } from '@/lib/review/stampMissingSourceLines';
import { makeTransaction } from '@tests/unit/factories';

describe('stampMissingSourceLines', () => {
  it('stamps PDF rows without a sourceLine', () => {
    const rows = [makeTransaction({ description: 'No number echoed' })];
    const stamped = stampMissingSourceLines(rows, 'pdf');
    expect(stamped[0].reviewReasons).toContain('source_line_missing');
  });

  it('does not stamp PDF rows that carry a sourceLine', () => {
    const rows = [makeTransaction({ description: 'Numbered', sourceLine: 12 })];
    const stamped = stampMissingSourceLines(rows, 'pdf');
    expect(stamped[0].reviewReasons).not.toContain('source_line_missing');
  });

  it('never stamps CSV/XLS/XLSX rows', () => {
    for (const format of ['csv', 'xls', 'xlsx'] as const) {
      const rows = [makeTransaction({})];
      const stamped = stampMissingSourceLines(rows, format);
      expect(stamped[0].reviewReasons).not.toContain('source_line_missing');
    }
  });

  it('returns the same array reference for non-PDF formats', () => {
    const rows = [makeTransaction({})];
    expect(stampMissingSourceLines(rows, 'csv')).toBe(rows);
  });

  it('unions onto existing reasons instead of replacing them', () => {
    const rows = [makeTransaction({ reviewReasons: ['low_confidence'] })];
    const stamped = stampMissingSourceLines(rows, 'pdf');
    expect(stamped[0].reviewReasons).toContain('low_confidence');
    expect(stamped[0].reviewReasons).toContain('source_line_missing');
  });
});
