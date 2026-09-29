import { describe, it, expect } from 'vitest';
import { numberStatementLines, formatCreditCardTransactionInput } from '@/lib/parsers/lineNumbering';

describe('numberStatementLines', () => {
  it('prefixes every line with its 1-based number and ||', () => {
    const numbered = numberStatementLines('Statement of Account\n\n02/04/2025||AMAZON||5000');
    expect(numbered).toBe(
      '1||Statement of Account\n2||\n3||02/04/2025||AMAZON||5000',
    );
  });

  it('numbers a single line', () => {
    expect(numberStatementLines('only line')).toBe('1||only line');
  });

  it('numbers empty text into one numbered empty line', () => {
    expect(numberStatementLines('')).toBe('1||');
  });

  it('is the identity contract for consumers: line N is split("\\n")[N-1] minus the prefix', () => {
    const text = 'alpha\nbeta\ngamma';
    const numbered = numberStatementLines(text);
    const lines = numbered.split('\n');
    expect(lines[0]).toBe('1||' + text.split('\n')[0]);
    expect(lines[2]).toBe('3||' + text.split('\n')[2]);
  });

  it('leaves the original string untouched (immutability — other passes see clean text)', () => {
    const original = 'a\nb';
    const copy = original;
    numberStatementLines(original);
    expect(original).toBe(copy);
    expect(original).toBe('a\nb');
  });
});

describe('formatCreditCardTransactionInput', () => {
  it('keeps unnamed cells aligned with their header positions', () => {
    expect(formatCreditCardTransactionInput(
      'DATE & TIME||||TRANSACTION DESCRIPTION||AMOUNT\n'
      + '12/09/2025 21:04||EMI||SwiggyBengaluru||14,897.00',
    )).toBe(
      '1||[1] "DATE & TIME"||[2] ""||[3] "TRANSACTION DESCRIPTION"||[4] "AMOUNT"\n'
      + '2||[1] "12/09/2025 21:04"||[2] "EMI"||[3] "SwiggyBengaluru"||[4] "14,897.00"',
    );
  });

  it('preserves every cell, including whitespace, quotes, signs and trailing empties', () => {
    const cells = ['', 'EMI', ' Merchant "quoted" \\ ref ', '+ 8.53', '$9.65', '', ''];
    const formatted = formatCreditCardTransactionInput(cells.join('||'));
    const decoded = formatted.split('||').slice(1).map((cell, index) => {
      const prefix = `[${index + 1}] `;
      expect(cell.startsWith(prefix)).toBe(true);
      return JSON.parse(cell.slice(prefix.length));
    });
    expect(decoded).toEqual(cells);
  });

  it('leaves prose and line identity intact across different table layouts', () => {
    const input = 'Statement\n\nDate||Description||Amount\n2025-09-12||EMI||12.34\n'
      + '--- PAGE BREAK ---\nAmount||||Narration||Date';
    const output = formatCreditCardTransactionInput(input).split('\n');
    expect(output).toHaveLength(input.split('\n').length);
    expect(output[0]).toBe('1||Statement');
    expect(output[1]).toBe('2||');
    expect(output[3]).toContain('[2] "EMI"');
    expect(output[4]).toBe('5||--- PAGE BREAK ---');
    expect(output[5]).toBe('6||[1] "Amount"||[2] ""||[3] "Narration"||[4] "Date"');
  });
});
