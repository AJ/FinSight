import { describe, it, expect } from 'vitest';
import { detectTableRegions } from '@/lib/parsers/extraction/tableDetector';
import type { Line, RawTextItem } from '@/lib/parsers/extraction/extractionTypes';

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

describe('detectTableRegions', () => {
  it('detects a single table region with valid header and data', () => {
    const lines = makeLines([
      [item('Date', 10, 100), item('Description', 100, 100), item('Debit', 250, 100), item('Credit', 350, 100)],
      [item('01-Jan', 10, 80), item('Amazon', 100, 80), item('500', 250, 80)],
      [item('02-Jan', 10, 60), item('Salary', 100, 60), item('50000', 350, 60)],
      [item('03-Jan', 10, 40), item('Groceries', 100, 40), item('200', 250, 40)],
    ]);
    const result = detectTableRegions(lines);
    expect(result.tableRegions).toHaveLength(1);
    expect(result.tableRegions[0].startLineIndex).toBe(0);
    expect(result.tableRegions[0].endLineIndex).toBe(4);
  });

  it('rejects a header candidate without date-like or numeric data below it', () => {
    const lines = makeLines([
      [item('Details', 10, 100), item('Cheque', 100, 100), item('Reference', 250, 100)],
      [item('Regulatory', 10, 80), item('notice', 100, 80), item('text', 250, 80)],
      [item('More', 10, 60), item('prose', 100, 60)],
    ]);
    const result = detectTableRegions(lines);
    expect(result.tableRegions).toHaveLength(0);
  });

  it('classifies non-table lines as prose regions', () => {
    const lines = makeLines([
      [item('Bank Name', 10, 100)],
      [item('Date', 10, 80), item('Description', 100, 80), item('Amount', 250, 80)],
      [item('01-Jan', 10, 60), item('Test', 100, 60), item('100', 250, 60)],
    ]);
    const result = detectTableRegions(lines);
    expect(result.proseRegions.length).toBeGreaterThanOrEqual(1);
  });

  it('detects multiple table regions on the same page', () => {
    const lines = makeLines([
      [item('Date', 10, 100), item('Description', 100, 100), item('Debit', 250, 100), item('Credit', 350, 100)],
      [item('01-Jan', 10, 80), item('Test', 100, 80), item('100', 250, 80)],
      [item('Add-on Card Holder: Jane', 10, 60)],
      [item('Date', 10, 40), item('Description', 100, 40), item('Amount', 250, 40)],
      [item('05-Jan', 10, 20), item('Purchase', 100, 20), item('200', 250, 20)],
    ]);
    const result = detectTableRegions(lines);
    expect(result.tableRegions).toHaveLength(2);
  });

  it('handles page with no tables at all', () => {
    const lines = makeLines([
      [item('Some', 10, 100), item('random', 100, 100), item('text', 200, 100)],
      [item('More', 10, 80), item('text', 100, 80)],
    ]);
    const result = detectTableRegions(lines);
    expect(result.tableRegions).toHaveLength(0);
    expect(result.proseRegions).toHaveLength(1);
  });

  it('handles empty input', () => {
    const result = detectTableRegions([]);
    expect(result.tableRegions).toHaveLength(0);
    expect(result.proseRegions).toHaveLength(0);
  });

  it('does not extend table region across page boundaries', () => {
    const lines: Line[] = [
      // Page 1: header + 1 transaction
      { y: 100, items: [item('Date', 10, 100, 1), item('Description', 100, 100, 1), item('Amount', 250, 100, 1)], page: 1 },
      { y: 80, items: [item('01-Jan', 10, 80, 1), item('Test', 100, 80, 1), item('100', 250, 80, 1)], page: 1 },
      // Page 2: different content at similar y-coordinates
      { y: 100, items: [item('Note', 10, 100, 2), item('Some', 100, 100, 2), item('Prose', 250, 100, 2)], page: 2 },
    ];
    const result = detectTableRegions(lines);
    expect(result.tableRegions).toHaveLength(1);
    expect(result.tableRegions[0].endLineIndex).toBe(2);
    expect(result.tableRegions[0].page).toBe(1);
  });

  it('includes noise-marker rows in the table region (noise filtering is downstream)', () => {
    const lines: Line[] = [
      { y: 100, items: [item('Date', 10, 100), item('Description', 100, 100), item('Amount', 250, 100)], page: 1 },
      { y: 80, items: [item('-', 10, 80), item('-', 100, 80), item('-', 250, 80)], page: 1 },
      { y: 60, items: [item('-', 10, 60), item('Opening Balance', 100, 60), item('49,154.62', 250, 60)], page: 1 },
      { y: 40, items: [item('01-Jan', 10, 40), item('Amazon', 100, 40), item('500', 250, 40)], page: 1 },
    ];
    const result = detectTableRegions(lines);
    expect(result.tableRegions).toHaveLength(1);
    // Region includes the Opening Balance row — noise filtering happens in row building
    expect(result.tableRegions[0].endLineIndex).toBe(4);
  });

  it('includes Closing Balance row in table region', () => {
    const lines: Line[] = [
      { y: 100, items: [item('Date', 10, 100), item('Description', 100, 100), item('Amount', 250, 100)], page: 1 },
      { y: 80, items: [item('01-Jan', 10, 80), item('Amazon', 100, 80), item('500', 250, 80)], page: 1 },
      { y: 60, items: [item('02-Jan', 10, 60), item('Closing Balance', 100, 60), item('1,35,000.00', 250, 60)], page: 1 },
    ];
    const result = detectTableRegions(lines);
    expect(result.tableRegions).toHaveLength(1);
    expect(result.tableRegions[0].endLineIndex).toBe(3);
  });

  it('stops table region at large vertical gap', () => {
    const lines: Line[] = [
      { y: 100, items: [item('Date', 10, 100), item('Description', 100, 100), item('Amount', 250, 100)], page: 1 },
      { y: 80, items: [item('01-Jan', 10, 80), item('Amazon', 100, 80), item('500', 250, 80)], page: 1 },
      // Gap from y=80 to y=10 is 70, vs prev gap of 20. 70 > 20*3=60 and > 30.
      { y: 10, items: [item('Disclaimer text', 10, 10)], page: 1 },
    ];
    const result = detectTableRegions(lines);
    expect(result.tableRegions).toHaveLength(1);
    expect(result.tableRegions[0].endLineIndex).toBe(2);
  });

  it('rejects header-only region with no data rows', () => {
    // Header followed immediately by another header
    const lines = makeLines([
      [item('Date', 10, 100), item('Description', 100, 100), item('Amount', 250, 100)],
      [item('Date', 10, 80), item('Description', 100, 80), item('Amount', 250, 80)],
    ]);
    const result = detectTableRegions(lines);
    // First header finds second header as endLine, dataStart === endLine, so no region
    expect(result.tableRegions).toHaveLength(0);
  });
});
