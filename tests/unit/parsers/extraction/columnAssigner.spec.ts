import { describe, it, expect } from 'vitest';
import { assignColumns } from '@/lib/parsers/extraction/columnAssigner';
import type { Line, TableRegion, ColumnSchema, RawTextItem } from '@/lib/parsers/extraction/extractionTypes';

function item(text: string, x: number, y: number, right?: number): RawTextItem {
  return { text, x, right: right ?? x + text.length * 6, y, page: 1, height: 9 };
}
function makeLines(itemGrid: RawTextItem[][]): Line[] {
  return itemGrid.map((items, i) => ({ y: 100 - i * 20, items, page: 1 }));
}
function makeSchema(cols: { text: string; x: number; right: number }[], snap = 3): ColumnSchema {
  return {
    columns: cols.map((c, i) => ({
      index: i, headerText: c.text, columnLeft: c.x, columnRight: c.right,
      type: 'unknown' as const,
    })),
    dateColumnIndex: 0,
    sourceRegionIndex: 0,
    snapTolerance: snap,
  };
}
const REGION: TableRegion[] = [{ startLineIndex: 0, endLineIndex: 3, page: 1 }];

describe('assignColumns (containment)', () => {
  it('assigns an item to the column whose range contains it', () => {
    const lines = makeLines([
      [item('Date', 10, 100, 40), item('Description', 60, 100, 150), item('Amount', 170, 100, 200)],
      [item('01-Jan', 10, 80, 40), item('Amazon', 62, 80, 130), item('500.00', 172, 80, 200)],
    ]);
    const schemas = [makeSchema([
      { text: 'Date', x: 10, right: 40 },
      { text: 'Description', x: 60, right: 150 },
      { text: 'Amount', x: 170, right: 200 },
    ])];
    const result = assignColumns(lines, REGION, schemas);
    expect(result[1].assignments).toEqual([0, 1, 2]);
    expect(result[0].isHeader).toBe(true);
  });

  it('snaps a near-miss within the schema tolerance', () => {
    const lines = makeLines([
      [item('Date', 10, 100, 40), item('Description', 60, 100, 150)],
      [item('01-Jan', 10, 80, 40), item('Amazon', 58, 80, 130)], // 2px left of 60
    ]);
    const schemas = [makeSchema([{ text: 'Date', x: 10, right: 40 }, { text: 'Description', x: 60, right: 150 }])];
    const result = assignColumns(lines, REGION, schemas);
    expect(result[1].assignments).toEqual([0, 1]);
  });

  it('sends a gap item beyond tolerance to the overflow slot (columns.length)', () => {
    const lines = makeLines([
      [item('Date', 10, 100, 40), item('Description', 60, 100, 150)],
      [item('01-Jan', 10, 80, 40), item('EMI', 48, 80, 55), item('Amazon', 62, 80, 130)],
    ]);
    const schemas = [makeSchema([{ text: 'Date', x: 10, right: 40 }, { text: 'Description', x: 60, right: 150 }])];
    const result = assignColumns(lines, REGION, schemas);
    expect(result[1].assignments).toEqual([0, 2, 1]);
  });

  it('an item left of all columns (beyond snap) goes to the overflow slot, not column 0', () => {
    // The stray sits 12px left of the first column — farther than the 3px
    // snap allowance, so it belongs to no column.
    const lines = makeLines([
      [item('Date', 20, 100, 40), item('Amount', 170, 100, 200)],
      [item('X', 2, 80, 8), item('01-Jan', 22, 80, 40), item('500.00', 172, 80, 200)],
    ]);
    const schemas = [makeSchema([{ text: 'Date', x: 20, right: 40 }, { text: 'Amount', x: 170, right: 200 }])];
    const result = assignColumns(lines, REGION, schemas);
    expect(result[1].assignments[0]).toBe(2); // overflow slot
    expect(result[1].assignments[1]).toBe(0);
  });

  it('a straddling item goes to the column with the largest overlap', () => {
    const lines = makeLines([
      [item('Desc', 60, 100, 150), item('Amt', 170, 100, 200)],
      [item('LONG DESCRIPTION TEXT', 60, 80, 185), item('5.00', 186, 80, 200)],
    ]);
    const schemas = [makeSchema([{ text: 'Desc', x: 60, right: 150 }, { text: 'Amt', x: 170, right: 200 }])];
    const result = assignColumns(lines, REGION, schemas);
    expect(result[1].assignments[0]).toBe(0); // 90px overlap with Desc vs 15 with Amt
  });

  it('returns empty for empty inputs', () => {
    expect(assignColumns([], [], [])).toEqual([]);
  });
});
