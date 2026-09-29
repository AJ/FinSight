import { describe, it, expect } from 'vitest';
import { buildColumnSchemas } from '@/lib/parsers/extraction/schemaBuilder';
import { assignColumns } from '@/lib/parsers/extraction/columnAssigner';
import { buildTransactionRows } from '@/lib/parsers/extraction/rowBuilder';
import type { Line, TableRegion, RawTextItem } from '@/lib/parsers/extraction/extractionTypes';

function item(text: string, x: number, right: number, y = 0): RawTextItem {
  return { text, x, right, y, page: 1, height: 9 };
}
function line(items: RawTextItem[], y: number): Line {
  return { y, items, page: 1 };
}

function makeRegion(): { lines: Line[]; regions: TableRegion[] } {
  const lines: Line[] = [
    line([item('DATE', 10, 40), item('DESCRIPTION', 60, 150), item('AMOUNT', 170, 200)], 100),
  ];
  for (let i = 0; i < 10; i++) {
    lines.push(line([item(`01/0${(i % 8) + 1}/2025`, 10, 40), item(`MERCHANT ${i}`, 60, 130), item(`${100 + i}.00`, 172, 200)], 90 - i * 10));
  }
  return { lines, regions: [{ startLineIndex: 0, endLineIndex: 11, page: 1 }] };
}

describe('buildColumnSchemas (stack-based)', () => {
  it('builds one schema per region with stack x-ranges and concept types', () => {
    const { lines, regions } = makeRegion();
    const schemas = buildColumnSchemas(lines, regions);
    expect(schemas).toHaveLength(1);
    expect(schemas[0].columns.map(c => c.headerText)).toEqual(['DATE', 'DESCRIPTION', 'AMOUNT']);
    expect(schemas[0].columns[0].columnLeft).toBe(10);
    expect(schemas[0].columns[0].columnRight).toBe(40);
    expect(schemas[0].columns[2].columnLeft).toBe(170);
    expect(schemas[0].dateColumnIndex).toBe(0);
    expect(typeof schemas[0].snapTolerance).toBe('number');
  });

  it('carries a headerless badge stack as a column with empty header text', () => {
    const lines: Line[] = [
      line([item('DATE', 10, 40), item('DESCRIPTION', 70, 150), item('AMOUNT', 170, 200)], 100),
    ];
    for (let i = 0; i < 10; i++) {
      const items = [item(`01/0${(i % 8) + 1}/2025`, 10, 40), item(`MERCHANT ${i}`, 70, 130), item(`${100 + i}.00`, 172, 200)];
      if (i % 3 === 0) items.push(item('EMI', 52, 60)); // gaps 12/10 — wider than the 9px tolerance
      lines.push(line(items, 90 - i * 10));
    }
    const schemas = buildColumnSchemas(lines, [{ startLineIndex: 0, endLineIndex: 11, page: 1 }]);
    expect(schemas[0].columns.map(c => c.headerText)).toEqual(['DATE', '', 'DESCRIPTION', 'AMOUNT']);
    expect(schemas[0].columns[1].type).toBe('unknown');
  });

  it('two date columns: dateColumnIndex is the leftmost', () => {
    const lines: Line[] = [
      line([item('CHARGE DATE', 10, 60), item('TRANSACTION DATE', 80, 140)], 100),
    ];
    for (let i = 0; i < 5; i++) {
      lines.push(line([item(`01/0${i + 1}/2025`, 10, 55), item(`02/0${i + 1}/2025`, 80, 135)], 90 - i * 10));
    }
    const schemas = buildColumnSchemas(lines, [{ startLineIndex: 0, endLineIndex: 6, page: 1 }]);
    expect(schemas[0].columns.map(c => c.type)).toEqual(['date', 'date']);
    expect(schemas[0].dateColumnIndex).toBe(0);
  });

  it('inherits the previous schema for a region with no header line', () => {
    const { lines, regions } = makeRegion();
    // A headerless region: its start line carries no items at all.
    lines.push(line([], -10));
    const regions2: TableRegion[] = [...regions, { startLineIndex: 11, endLineIndex: 12, page: 1 }];
    const schemas = buildColumnSchemas(lines, regions2);
    expect(schemas).toHaveLength(2);
    expect(schemas[1].columns).toEqual(schemas[0].columns);
    expect(schemas[1].sourceRegionIndex).toBe(1);
  });

  it('retains equal bounds for repeated headers with equal geometry', () => {
    const { lines, regions } = makeRegion();
    // A second page: header repeated, same concepts, same geometry.
    lines.push(line([item('DATE', 10, 40), item('DESCRIPTION', 60, 150), item('AMOUNT', 170, 200)], -100));
    for (let i = 0; i < 3; i++) {
      lines.push(line([item(`01/0${i + 1}/2025`, 10, 40), item(`M ${i}`, 60, 90), item(`${200 + i}.00`, 172, 200)], -110 - i * 10));
    }
    const regions2: TableRegion[] = [...regions, { startLineIndex: 11, endLineIndex: 15, page: 2 }];
    const schemas = buildColumnSchemas(lines, regions2);
    expect(schemas).toHaveLength(2);
    // Same physical bounds, different region index.
    expect(schemas[1].columns).toEqual(schemas[0].columns);
  });

  it.each([
    { scale: 1, offset: 200 },
    { scale: 0.5, offset: 300 },
    { scale: 2, offset: 100 },
  ])('uses local geometry for a repeated table at scale $scale, offset $offset', ({ scale, offset }) => {
    const first = makeRegion();
    const second = makeRegion();
    const shifted = second.lines.map(original => ({
      ...original,
      page: 2,
      items: original.items.map(value => ({
        ...value,
        page: 2,
        y: original.y,
        x: value.x * scale + offset,
        right: value.right * scale + offset,
        height: value.height * scale,
      })),
    }));
    const lines = [...first.lines, ...shifted];
    const regions = [...first.regions, {
      startLineIndex: first.lines.length, endLineIndex: lines.length, page: 2,
    }];
    const schemas = buildColumnSchemas(lines, regions);
    const localSchema = buildColumnSchemas(shifted, second.regions)[0];
    expect(schemas[1].columns).toEqual(localSchema.columns);
    expect(schemas[1].snapTolerance).toBe(localSchema.snapTolerance);
    expect(schemas[1].sourceRegionIndex).toBe(1);

    const assigned = assignColumns(lines, regions, schemas);
    for (const entry of assigned) expect(entry.assignments).toEqual([0, 1, 2]);
    const { rows } = buildTransactionRows(assigned, schemas);
    const transactions = rows.filter(row => !row.lines.some(entry => entry.isHeader));
    expect(transactions).toHaveLength(20);
    expect(transactions.map(row => row.columnValues)).toEqual(
      [first.lines.slice(1), shifted.slice(1)].flat().map(row => row.items.map(value => value.text)),
    );
    // Preserve each physical source row exactly once, including equal-valued
    // transactions on different pages; do not infer identity from their values.
    expect(transactions.flatMap(row => row.lines.map(entry => entry.line))).toEqual(
      [first.lines.slice(1), shifted.slice(1)].flat(),
    );
  });
});
