import { describe, it, expect } from 'vitest';
import { assignColumns } from '@/lib/parsers/extraction/columnAssigner';
import type { Line, TableRegion, ColumnSchema, RawTextItem } from '@/lib/parsers/extraction/extractionTypes';

function item(text: string, x: number, y: number, page: number = 1, right?: number): RawTextItem {
  return { text, x, right: right ?? x + text.length * 6, y, page };
}

function makeLines(itemGrid: RawTextItem[][]): Line[] {
  return itemGrid.map((items, i) => ({
    y: 100 - i * 20,
    items,
    page: items[0]?.page ?? 1,
  }));
}

function makeSchema(cols: { text: string; x: number; right: number }[]): ColumnSchema {
  return {
    columns: cols.map((c, i) => ({
      index: i,
      headerText: c.text,
      columnLeft: c.x,
      columnRight: c.right,
      type: 'unknown' as const,
    })),
    dateColumnIndex: 0,
    sourceRegionIndex: 0,
  };
}

describe('assignColumns', () => {
  it('assigns items to correct columns for a left-aligned table', () => {
    const lines = makeLines([
      [item('Date', 10, 100, 1, 40), item('Description', 50, 100, 1, 140), item('Amount', 150, 100, 1, 200)],
      [item('01-Jan', 10, 80, 1, 40), item('Amazon', 50, 80, 1, 90), item('500', 150, 80, 1, 175)],
      [item('02-Jan', 10, 60, 1, 40), item('Groceries', 50, 60, 1, 110), item('200', 150, 60, 1, 175)],
    ]);
    const regions: TableRegion[] = [{ startLineIndex: 0, endLineIndex: 3, page: 1 }];
    const schemas = [makeSchema([
      { text: 'Date', x: 10, right: 40 },
      { text: 'Description', x: 50, right: 140 },
      { text: 'Amount', x: 150, right: 200 },
    ])];

    const result = assignColumns(lines, regions, schemas);

    expect(result[0].assignments).toEqual([0, 1, 2]);
    expect(result[0].isHeader).toBe(true);
    expect(result[1].assignments).toEqual([0, 1, 2]);
    expect(result[2].assignments).toEqual([0, 1, 2]);
  });

  it('assigns right-aligned numeric columns correctly', () => {
    // Wide spacing between Description and Debit/Credit — items start
    // before their header's left edge (right-aligned), testing that
    // proximity-based Pass 1 handles this via right-edge matching.
    const lines = makeLines([
      [item('Date', 10, 100, 1, 40), item('Description', 50, 100, 1, 140), item('Debit', 200, 100, 1, 230), item('Credit', 300, 100, 1, 330)],
      [item('01-Jan', 10, 80, 1, 40), item('Amazon', 50, 80, 1, 90), item('500.00', 175, 80, 1, 230)],
      [item('02-Jan', 10, 60, 1, 40), item('Salary', 50, 60, 1, 85), item('50000.00', 245, 60, 1, 330)],
    ]);
    const regions: TableRegion[] = [{ startLineIndex: 0, endLineIndex: 3, page: 1 }];
    const schemas = [makeSchema([
      { text: 'Date', x: 10, right: 40 },
      { text: 'Description', x: 50, right: 140 },
      { text: 'Debit', x: 200, right: 230 },
      { text: 'Credit', x: 300, right: 330 },
    ])];

    const result = assignColumns(lines, regions, schemas);

    // "500.00"@175 right-aligned in Debit (right edge matches header right=230)
    expect(result[1].assignments[2]).toBe(2);
    // "50000.00"@245 right-aligned in Credit (right edge matches header right=330)
    expect(result[2].assignments[2]).toBe(3);
  });

  it('handles items slightly before header position', () => {
    const lines = makeLines([
      [item('Date', 75, 100, 1, 93), item('Description', 124, 100, 1, 167)],
      [item('31 Dec', 73, 80, 1, 93), item('Amazon', 124, 80, 1, 150)],
    ]);
    const regions: TableRegion[] = [{ startLineIndex: 0, endLineIndex: 2, page: 1 }];
    const schemas = [makeSchema([
      { text: 'Date', x: 75, right: 93 },
      { text: 'Description', x: 124, right: 167 },
    ])];

    const result = assignColumns(lines, regions, schemas);
    expect(result[1].assignments[0]).toBe(0);
  });

  it('marks header lines correctly', () => {
    const lines = makeLines([
      [item('Date', 10, 100, 1, 40), item('Amount', 50, 100, 1, 100)],
      [item('01-Jan', 10, 80, 1, 40), item('100', 50, 80, 1, 75)],
    ]);
    const regions: TableRegion[] = [{ startLineIndex: 0, endLineIndex: 2, page: 1 }];
    const schemas = [makeSchema([
      { text: 'Date', x: 10, right: 40 },
      { text: 'Amount', x: 50, right: 100 },
    ])];

    const result = assignColumns(lines, regions, schemas);
    expect(result[0].isHeader).toBe(true);
    expect(result[1].isHeader).toBe(false);
  });

  it('returns empty result for empty inputs', () => {
    expect(assignColumns([], [], [])).toEqual([]);
  });

  it('skips regions with no matching schema', () => {
    const lines = makeLines([
      [item('Date', 10, 100, 1, 40), item('Amount', 50, 100, 1, 100)],
      [item('01-Jan', 10, 80, 1, 40), item('100', 50, 80, 1, 75)],
    ]);
    const regions: TableRegion[] = [{ startLineIndex: 0, endLineIndex: 2, page: 1 }];
    // No schemas provided — region should be skipped
    expect(assignColumns(lines, regions, [])).toEqual([]);
  });

  it('detects right-aligned columns from consistent right edges', () => {
    // Amounts have consistent right edge (x=225) but varying left edges.
    // With >1 data item, leftSpread > rightSpread triggers the 'right' alignment path.
    const lines = makeLines([
      [item('Date', 10, 100, 1, 40), item('Description', 50, 100, 1, 100), item('Amount', 200, 100, 1, 225)],
      [item('01-Jan', 10, 80, 1, 40), item('Rent', 50, 80, 1, 80), item('50,000.00', 135, 80, 1, 225)],
      [item('02-Jan', 10, 60, 1, 40), item('Coffee', 50, 60, 1, 90), item('5.00', 195, 60, 1, 225)],
      [item('03-Jan', 10, 40, 1, 40), item('Groceries', 50, 40, 1, 110), item('1,500.00', 165, 40, 1, 225)],
    ]);
    const regions: TableRegion[] = [{ startLineIndex: 0, endLineIndex: 4, page: 1 }];
    const schemas = [makeSchema([
      { text: 'Date', x: 10, right: 40 },
      { text: 'Description', x: 50, right: 100 },
      { text: 'Amount', x: 200, right: 225 },
    ])];

    const result = assignColumns(lines, regions, schemas);

    // Right-aligned amount items should still be assigned to column 2
    expect(result[1].assignments[2]).toBe(2);
    expect(result[2].assignments[2]).toBe(2);
    expect(result[3].assignments[2]).toBe(2);
  });

  it('falls back to column 0 when item is left of all column boundaries', () => {
    // Two-column table where data items are far right of headers.
    // Computed geometry shifts right — column 0's columnLeft ≈ 97.
    // Date header at x=10 is left of ALL column boundaries,
    // so assignByGeometry iterates all columns without matching and returns 0.
    const lines = makeLines([
      [item('Date', 10, 100, 1, 40), item('Amount', 200, 100, 1, 230)],
      [item('01-Jan', 100, 80, 1, 130), item('500.00', 300, 80, 1, 330)],
    ]);
    const regions: TableRegion[] = [{ startLineIndex: 0, endLineIndex: 2, page: 1 }];
    const schemas = [makeSchema([
      { text: 'Date', x: 10, right: 40 },
      { text: 'Amount', x: 200, right: 230 },
    ])];

    const result = assignColumns(lines, regions, schemas);

    // Date header (x=10) is left of all computed boundaries → fallback to column 0.
    // With 2 columns, this is unambiguous: column 0's boundary is ≈97.
    expect(result[0].assignments[0]).toBe(0);
    // Data items are correctly assigned to their respective columns
    expect(result[1].assignments[0]).toBe(0);
    expect(result[1].assignments[1]).toBe(1);
  });

  it('handles header-only region with no data rows', () => {
    const lines = makeLines([
      [item('Date', 10, 100, 1, 40), item('Amount', 50, 100, 1, 100)],
    ]);
    const regions: TableRegion[] = [{ startLineIndex: 0, endLineIndex: 1, page: 1 }];
    const schemas = [makeSchema([
      { text: 'Date', x: 10, right: 40 },
      { text: 'Amount', x: 50, right: 100 },
    ])];

    const result = assignColumns(lines, regions, schemas);
    // Only the header line — no data rows to process
    expect(result).toHaveLength(1);
    expect(result[0].isHeader).toBe(true);
  });
});
