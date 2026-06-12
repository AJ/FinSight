import { describe, it, expect } from 'vitest';
import { groupIntoLines } from '@/lib/parsers/extraction/lineGrouper';
import { detectTableRegions } from '@/lib/parsers/extraction/tableDetector';
import { buildColumnSchemas } from '@/lib/parsers/extraction/schemaBuilder';
import { assignColumns } from '@/lib/parsers/extraction/columnAssigner';
import { buildTransactionRows } from '@/lib/parsers/extraction/rowBuilder';
import { formatOutput } from '@/lib/parsers/extraction/outputFormatter';
import type { RawTextItem } from '@/lib/parsers/extraction/extractionTypes';

function item(text: string, x: number, y: number, page: number = 1, right?: number): RawTextItem {
  return { text, x, right: right ?? x + text.length * 6, y, page };
}

describe('Pipeline integration', () => {
  it('processes a simple table through all stages', () => {
    const items: RawTextItem[] = [
      item('Date', 10, 100, 1, 40),
      item('Description', 50, 100, 1, 140),
      item('Amount', 150, 100, 1, 200),
      item('01-Jan', 10, 80, 1, 40),
      item('Amazon', 50, 80, 1, 90),
      item('500.00', 150, 80, 1, 200),
      item('02-Jan', 10, 60, 1, 40),
      item('Groceries', 50, 60, 1, 110),
      item('200.00', 150, 60, 1, 200),
    ];

    const lines = groupIntoLines(items);
    expect(lines).toHaveLength(3);

    const { tableRegions, proseRegions } = detectTableRegions(lines);
    expect(tableRegions).toHaveLength(1);
    expect(proseRegions).toHaveLength(0);

    const schemas = buildColumnSchemas(lines, tableRegions);
    expect(schemas).toHaveLength(1);
    expect(schemas[0].columns).toHaveLength(3);
    expect(schemas[0].dateColumnIndex).toBe(0);

    const assigned = assignColumns(lines, tableRegions, schemas);
    expect(assigned).toHaveLength(3); // header + 2 data rows

    const { rows } = buildTransactionRows(assigned, schemas);
    expect(rows).toHaveLength(3); // header + 2 data rows

    const output = formatOutput({ rows, proseRegions, allLines: lines, schemas });
    expect(output).toContain('||');
    expect(output).toContain('Date||Description||Amount');
    expect(output).toContain('Amazon');
  });

  it('processes a table with mixed column alignment through all stages', () => {
    const items: RawTextItem[] = [
      item('Date', 10, 100, 1, 40),
      item('Description', 50, 100, 1, 140),
      item('Debit', 200, 100, 1, 230),
      item('Credit', 300, 100, 1, 330),
      item('01-Jan', 10, 80, 1, 40),
      item('Amazon', 50, 80, 1, 90),
      item('500.00', 175, 80, 1, 230),
      item('02-Jan', 10, 60, 1, 40),
      item('Salary', 50, 60, 1, 85),
      item('50000.00', 245, 60, 1, 330),
    ];

    const lines = groupIntoLines(items);
    const { tableRegions, proseRegions } = detectTableRegions(lines);
    const schemas = buildColumnSchemas(lines, tableRegions);
    const assigned = assignColumns(lines, tableRegions, schemas);
    const { rows } = buildTransactionRows(assigned, schemas);
    const output = formatOutput({ rows, proseRegions, allLines: lines, schemas });

    expect(rows).toHaveLength(3); // header + 2 data rows
    expect(output).toContain('Date||Description||Debit||Credit');
    expect(output).toContain('500.00');
    expect(output).toContain('50000.00');
  });

  it('produces empty output from empty items', () => {
    const lines = groupIntoLines([]);
    const { tableRegions, proseRegions } = detectTableRegions(lines);
    const schemas = buildColumnSchemas(lines, tableRegions);
    const assigned = assignColumns(lines, tableRegions, schemas);
    const { rows } = buildTransactionRows(assigned, schemas);
    const output = formatOutput({ rows, proseRegions, allLines: lines, schemas });
    expect(output).toBe('');
  });

  it('handles all-prose input with no table headers', () => {
    const items: RawTextItem[] = [
      item('Bank Statement', 10, 100, 1),
      item('Account: 12345', 10, 80, 1),
      item('Total: 50,000.00', 10, 60, 1),
    ];
    const lines = groupIntoLines(items);
    const { tableRegions, proseRegions } = detectTableRegions(lines);
    expect(tableRegions).toHaveLength(0);
    expect(proseRegions).toHaveLength(1);

    const schemas = buildColumnSchemas(lines, tableRegions);
    const assigned = assignColumns(lines, tableRegions, schemas);
    const { rows } = buildTransactionRows(assigned, schemas);
    const output = formatOutput({ rows, proseRegions, allLines: lines, schemas });
    expect(output).toContain('Bank Statement');
    expect(output).toContain('Account: 12345');
    expect(output).not.toContain('||');
  });
});
