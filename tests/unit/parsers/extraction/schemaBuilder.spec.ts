import { describe, it, expect } from 'vitest';
import { buildColumnSchemas } from '@/lib/parsers/extraction/schemaBuilder';
import type { Line, TableRegion, RawTextItem } from '@/lib/parsers/extraction/extractionTypes';

function item(text: string, x: number, y: number, page: number = 1): RawTextItem {
  return { text, x, right: x + text.length * 6, y, page };
}

function makeLines(itemGrid: RawTextItem[][]): Line[] {
  return itemGrid.map((items, i) => ({
    y: 100 - i * 20,
    items,
    page: items[0]?.page ?? 1,
  }));
}

describe('buildColumnSchemas', () => {
  it('builds schema from a single table region', () => {
    const lines = makeLines([
      [item('Date', 10, 100), item('Description', 100, 100), item('Debit', 250, 100), item('Credit', 350, 100)],
      [item('01-Jan', 10, 80), item('Test', 100, 80), item('100', 250, 80)],
    ]);
    const regions: TableRegion[] = [
      { startLineIndex: 0, endLineIndex: 2, page: 1 },
    ];
    const schemas = buildColumnSchemas(lines, regions);
    expect(schemas).toHaveLength(1);
    expect(schemas[0].columns).toHaveLength(4);
    expect(schemas[0].columns[0].headerText).toBe('Date');
    expect(schemas[0].dateColumnIndex).toBe(0);
    expect(schemas[0].sourceRegionIndex).toBe(0);
  });

  it('reuses schema when headers match by concept (different synonyms)', () => {
    const lines = makeLines([
      [item('Date', 10, 100), item('Description', 100, 100), item('Amount', 250, 100)],
      [item('01-Jan', 10, 80), item('Test', 100, 80), item('100', 250, 80)],
      [item('Txn Date', 10, 60), item('Narration', 100, 60), item('Amount', 250, 60)],
      [item('02-Jan', 10, 40), item('Test2', 100, 40), item('200', 250, 40)],
    ]);
    const regions: TableRegion[] = [
      { startLineIndex: 0, endLineIndex: 2, page: 1 },
      { startLineIndex: 2, endLineIndex: 4, page: 1 },
    ];
    const schemas = buildColumnSchemas(lines, regions);
    expect(schemas).toHaveLength(2);
    expect(schemas[1].columns).toEqual(schemas[0].columns);
  });

  it('creates new schema when headers differ', () => {
    const lines = makeLines([
      [item('Date', 10, 100), item('Description', 100, 100), item('Debit', 250, 100), item('Credit', 350, 100)],
      [item('01-Jan', 10, 80), item('Test', 100, 80), item('100', 250, 80)],
      [item('Txn Date', 10, 60), item('Narration', 100, 60), item('Amount', 250, 60)],
      [item('02-Jan', 10, 40), item('Test2', 100, 40), item('200', 250, 40)],
    ]);
    const regions: TableRegion[] = [
      { startLineIndex: 0, endLineIndex: 2, page: 1 },
      { startLineIndex: 2, endLineIndex: 4, page: 1 },
    ];
    const schemas = buildColumnSchemas(lines, regions);
    expect(schemas).toHaveLength(2);
    expect(schemas[0].columns).toHaveLength(4);
    expect(schemas[1].columns).toHaveLength(3);
    expect(schemas[1].dateColumnIndex).toBe(0);
  });

  it('detects dateColumnIndex correctly when date is not first column', () => {
    const lines = makeLines([
      [item('#', 10, 100), item('Date', 50, 100), item('Description', 100, 100), item('Amount', 250, 100)],
      [item('1', 10, 80), item('01-Jan', 50, 80), item('Test', 100, 80), item('100', 250, 80)],
    ]);
    const regions: TableRegion[] = [
      { startLineIndex: 0, endLineIndex: 2, page: 1 },
    ];
    const schemas = buildColumnSchemas(lines, regions);
    expect(schemas[0].dateColumnIndex).toBe(1);
  });

  it('inherits schema when region has no header line', () => {
    const lines = makeLines([
      [item('Date', 10, 100), item('Description', 100, 100), item('Amount', 250, 100)],
      [item('01-Jan', 10, 80), item('Test', 100, 80), item('100', 250, 80)],
    ]);
    const regions: TableRegion[] = [
      { startLineIndex: 0, endLineIndex: 2, page: 1 },
      { startLineIndex: 2, endLineIndex: 3, page: 1 }, // no header at index 2
    ];
    const schemas = buildColumnSchemas(lines, regions);
    expect(schemas).toHaveLength(2);
    expect(schemas[1].columns).toEqual(schemas[0].columns);
  });

  it('detects mismatched concepts when column counts match but concepts differ', () => {
    // First region: Date, Description, Amount (concepts: date, description, amount)
    // Second region: Date, Debit, Credit (concepts: date, debit, credit)
    // Same column count (3) but different concepts → new schema, not reused
    const lines = makeLines([
      [item('Date', 10, 100), item('Description', 100, 100), item('Amount', 250, 100)],
      [item('01-Jan', 10, 80), item('Test', 100, 80), item('100', 250, 80)],
      [item('Date', 10, 60), item('Debit', 100, 60), item('Credit', 250, 60)],
      [item('02-Jan', 10, 40), item('200', 100, 40), item('300', 250, 40)],
    ]);
    const regions: TableRegion[] = [
      { startLineIndex: 0, endLineIndex: 2, page: 1 },
      { startLineIndex: 2, endLineIndex: 4, page: 1 },
    ];
    const schemas = buildColumnSchemas(lines, regions);
    expect(schemas).toHaveLength(2);
    expect(schemas[0].columns[1].headerText).toBe('Description');
    expect(schemas[1].columns[1].headerText).toBe('Debit');
  });

  it('skips schema inheritance when first region has no header and no prior schema', () => {
    // Region 0 has startLineIndex=0 but the line at index 0 is empty (no header items),
    // so no schema is created and there's no prior schema to inherit from.
    const linesWithGap: Line[] = [
      { y: 100, items: [], page: 1 }, // empty header line
      { y: 80, items: [item('01-Jan', 10, 80), item('Test', 100, 80)], page: 1 },
    ];
    const regions: TableRegion[] = [
      { startLineIndex: 0, endLineIndex: 2, page: 1 },
    ];
    const schemas = buildColumnSchemas(linesWithGap, regions);
    // No header items → no schema created (no prior schema to inherit from)
    expect(schemas).toHaveLength(0);
  });

  it('detects date column at non-zero index via concept matching', () => {
    const lines = makeLines([
      [item('Description', 10, 100), item('Date', 100, 100), item('Amount', 250, 100)],
      [item('Test', 10, 80), item('01-Jan', 100, 80), item('100', 250, 80)],
    ]);
    const regions: TableRegion[] = [
      { startLineIndex: 0, endLineIndex: 2, page: 1 },
    ];
    const schemas = buildColumnSchemas(lines, regions);
    expect(schemas[0].dateColumnIndex).toBe(1);
  });

  it('handles empty regions', () => {
    const schemas = buildColumnSchemas([], []);
    expect(schemas).toHaveLength(0);
  });
});
