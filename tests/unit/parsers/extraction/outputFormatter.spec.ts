import { describe, it, expect } from 'vitest';
import { formatOutput } from '@/lib/parsers/extraction/outputFormatter';
import type { LogicalRow, ProseRegion, Line, ColumnSchema, AssignedLine } from '@/lib/parsers/extraction/extractionTypes';

function makeRow(values: string[], regionIndex: number = 0, y: number = 100, page: number = 1): LogicalRow {
  return {
    lines: [{
      line: {
        y,
        items: values.map((t, i) => ({
          text: t,
          x: i * 100,
          right: i * 100 + t.length * 6,
          y,
          page,
        })),
        page,
      },
      assignments: values.map((_, i) => i),
      isHeader: false,
      regionIndex,
    }],
    columnValues: values,
    regionIndex,
  };
}

function makeLine(texts: string[], y: number, page: number): Line {
  return {
    y,
    items: texts.map((t, i) => ({
      text: t,
      x: i * 100,
      right: i * 100 + t.length * 6,
      y,
      page,
    })),
    page,
  };
}

function makeSchema(regionIndex: number, headerTexts: string[]): ColumnSchema {
  return {
    columns: headerTexts.map((t, i) => ({
      index: i,
      headerText: t,
      columnLeft: i * 100,
      columnRight: (i + 1) * 100,
      type: 'unknown' as const,
    })),
    dateColumnIndex: 0,
    sourceRegionIndex: regionIndex,
  };
}

describe('formatOutput', () => {
  it('formats table rows as ||-delimited text', () => {
    const rows = [
      makeRow(['Date', 'Description', 'Amount'], 0),
      makeRow(['01-Jan', 'Amazon', '500.00'], 0),
    ];
    const result = formatOutput({ rows, proseRegions: [], allLines: [], schemas: [] });
    expect(result).toContain('Date||Description||Amount');
    expect(result).toContain('01-Jan||Amazon||500.00');
  });

  it('separates different-schema tables with blank lines', () => {
    const rows = [
      makeRow(['Date', 'Description', 'Debit', 'Credit'], 0, 100, 1),
      makeRow(['01-Jan', 'Test', '100', ''], 0, 80, 1),
      makeRow(['Date', 'Description', 'Amount'], 1, 60, 1),
      makeRow(['05-Jan', 'Test2', '200'], 1, 40, 1),
    ];
    const schemas = [
      makeSchema(0, ['Date', 'Description', 'Debit', 'Credit']),
      makeSchema(1, ['Date', 'Description', 'Amount']),
    ];
    const result = formatOutput({ rows, proseRegions: [], allLines: [], schemas });
    const parts = result.split('\n\n');
    expect(parts).toHaveLength(2);
  });

  it('includes prose regions as plain text', () => {
    const proseRegions: ProseRegion[] = [
      { startLineIndex: 0, endLineIndex: 1, page: 1 },
    ];
    const allLines: Line[] = [
      makeLine(['Bank Statement', 'Account: 12345'], 100, 1),
    ];
    const result = formatOutput({ rows: [], proseRegions, allLines, schemas: [] });
    expect(result).toContain('Bank Statement');
    expect(result).toContain('Account: 12345');
  });

  it('inserts page break markers between pages', () => {
    const rows = [makeRow(['01-Jan', 'Test'], 0, 100, 1)];
    const proseRegions: ProseRegion[] = [{ startLineIndex: 0, endLineIndex: 1, page: 2 }];
    const allLines = [makeLine(['Footer'], 10, 2)];
    const result = formatOutput({ rows, proseRegions, allLines, schemas: [] });
    expect(result).toContain('--- PAGE BREAK ---');
  });

  it('separates tables with same column count but different headers', () => {
    const rows = [
      makeRow(['Date', 'Description', 'Amount'], 0, 100, 1),
      makeRow(['01-Jan', 'Test', '100'], 0, 80, 1),
      makeRow(['Date', 'Description', 'Debit'], 1, 60, 1),
      makeRow(['05-Jan', 'Test2', '200'], 1, 40, 1),
    ];
    const schemas = [
      makeSchema(0, ['Date', 'Description', 'Amount']),
      makeSchema(1, ['Date', 'Description', 'Debit']),
    ];
    const result = formatOutput({ rows, proseRegions: [], allLines: [], schemas });
    // Same column count (3) but different header text → schemasDiffer triggers via .some()
    const parts = result.split('\n\n');
    expect(parts).toHaveLength(2);
  });

  it('handles empty input', () => {
    const result = formatOutput({ rows: [], proseRegions: [], allLines: [], schemas: [] });
    expect(result).toBe('');
  });

  it('renders postTableLines as prose in output', () => {
    const rows = [
      makeRow(['01-Jan', 'Transaction', '100'], 0, 100, 1),
    ];
    const postTableLines: AssignedLine[] = [
      {
        line: {
          y: 60,
          items: [
            { text: 'Statement', x: 0, right: 60, y: 60, page: 1 },
            { text: 'generated', x: 70, right: 130, y: 60, page: 1 },
          ],
          page: 1,
        },
        assignments: [0, 1],
        isHeader: false,
        regionIndex: 0,
      },
    ];

    const result = formatOutput({ rows, proseRegions: [], allLines: [], schemas: [], postTableLines });
    expect(result).toContain('Statement generated');
    expect(result).toContain('01-Jan||Transaction||100');
  });

  it('returns empty string when only postTableLines present but empty', () => {
    const result = formatOutput({ rows: [], proseRegions: [], allLines: [], schemas: [], postTableLines: [] });
    expect(result).toBe('');
  });

  it('includes postTableLines pages in page tracking', () => {
    // Row on page 1, post-table line on page 2 → should have page break
    const rows = [
      makeRow(['01-Jan', 'Transaction', '100'], 0, 100, 1),
    ];
    const postTableLines: AssignedLine[] = [
      {
        line: {
          y: 60,
          items: [{ text: 'Footer', x: 0, right: 40, y: 60, page: 2 }],
          page: 2,
        },
        assignments: [0],
        isHeader: false,
        regionIndex: 0,
      },
    ];

    const result = formatOutput({ rows, proseRegions: [], allLines: [], schemas: [], postTableLines });
    expect(result).toContain('--- PAGE BREAK ---');
    expect(result).toContain('Footer');
  });
});
