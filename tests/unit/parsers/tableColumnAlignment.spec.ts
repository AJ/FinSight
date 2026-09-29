import { describe, expect, it } from 'vitest';
import { alignTableColumns } from '@/lib/parsers/tableColumnAlignment';
import { formatCreditCardTransactionInput } from '@/lib/parsers/lineNumbering';
import type { StatementTableInfo } from '@/lib/parsers/extraction/extractionTypes';

const table = (headerLineIndex: number, headers: string[], dataRowLineIndexes: number[]): StatementTableInfo => ({
  headerLineIndex, dataRowLineIndexes,
  columns: headers.map(headerText => ({ headerText, type: 'unknown' })),
});
const first = ['DATE & TIME', 'TRANSACTION DESCRIPTION', 'REWARDS', '', '', 'AMOUNT', 'PI'];
const second = ['DATE & TIME', '', 'TRANSACTION DESCRIPTION', 'REWARDS', '', '', '', 'AMOUNT', 'PI'];
const rows = [
  first,
  ['03/09/2025 00:00', 'Global Value_Cash Back', '', '+', 'C', '8.53', 'l'],
  second,
  ['12/09/2025 21:04', 'EMI', 'SwiggyBengaluru', '', 'C', '', '', '14,897.00', 'l'],
];
const source = rows.map(row => row.join('||')).join('\n');
const tables = [table(0, first, [1]), table(2, second, [3])];

describe('alignTableColumns', () => {
  it('pads the first layout without changing the second or losing credit signs', () => {
    const aligned = alignTableColumns(source, tables).split('\n').map(line => line.split('||'));
    expect(aligned).toEqual([
      second,
      ['03/09/2025 00:00', '', 'Global Value_Cash Back', '', '+', 'C', '', '8.53', 'l'],
      second, rows[3],
    ]);
    expect(formatCreditCardTransactionInput(source, tables).split('\n')[1])
      .toContain('[3] "Global Value_Cash Back"');
  });

  it('preserves every value in order, prose, source identities and overflow cells', () => {
    const headers = ['', 'date', '', 'desc', '', 'amount', ''];
    const other = ['date', 'desc', '', '', 'amount'];
    const data = [headers, ['', 'd', 'label', 'quoted " \\ $&', '', '+ 5', '', 'overflow'],
      ['prose'], other, ['d2', 'merchant', 'x', 'y', '6']];
    const text = data.map(row => row.join('||')).join('\n');
    const aligned = alignTableColumns(text, [table(0, headers, [1]), table(3, other, [4])])
      .split('\n').map(line => line.split('||'));
    expect(aligned).toHaveLength(data.length);
    data.forEach((row, index) => expect(aligned[index].filter(Boolean)).toEqual(row.filter(Boolean)));
    expect(aligned[2]).toEqual(['prose']);
    expect(aligned[0].indexOf('amount')).toBe(aligned[3].indexOf('amount'));
    expect(aligned[1].at(-1)).toBe('overflow');
    expect(aligned[4].at(-1)).toBe('');
  });

  it('matches only case/whitespace differences, not different or reordered names', () => {
    const variants = [
      [' date ', '', 'DESC'], ['DATE', ' desc '],
      ['date', 'narration'], ['desc', 'date'],
    ];
    const text = variants.map(row => row.join('||')).join('\n');
    const result = alignTableColumns(text, variants.map((row, index) => table(index, row, []))).split('\n');
    expect(result[1]).toBe('DATE|||| desc ');
    expect(result.slice(2)).toEqual(text.split('\n').slice(2));
  });

  it.each(['mismatch', 'overlap', 'invalid index', 'duplicate names', 'no metadata', 'single table'])
    ('leaves unsafe or unmatched layouts unchanged: %s', condition => {
      const metadata = structuredClone(tables);
      if (condition === 'mismatch') metadata[0].columns[0].headerText = 'date';
      if (condition === 'overlap') metadata[1].dataRowLineIndexes.push(1);
      if (condition === 'invalid index') metadata[0].dataRowLineIndexes.push(99);
      if (condition === 'duplicate names') metadata.forEach(t => { t.columns[2].headerText = 'DATE & TIME'; });
      if (condition === 'no metadata') metadata.length = 0;
      if (condition === 'single table') metadata.length = 1;
      expect(alignTableColumns(source, metadata)).toBe(source);
    });
});
