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
      [item('01-Jan', 10, 80), item('Amazon', 100, 80), item('500.00', 250, 80)],
      [item('02-Jan', 10, 60), item('Salary', 100, 60), item('50000.00', 350, 60)],
      [item('03-Jan', 10, 40), item('Groceries', 100, 40), item('200.00', 250, 40)],
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
      [item('01-Jan', 10, 80), item('Test', 100, 80), item('100.00', 250, 80)],
      [item('02-Jan', 10, 60), item('Test2', 100, 60), item('101.00', 250, 60)],
      [item('Add-on Card Holder: Jane', 10, 40)],
      [item('Date', 10, 20), item('Description', 100, 20), item('Amount', 250, 20)],
      [item('05-Jan', 10, 0), item('Purchase', 100, 0), item('200.00', 250, 0)],
      [item('06-Jan', 10, -20), item('Purchase2', 100, -20), item('201.00', 250, -20)],
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
      // Page 1: header + 2 transactions
      { y: 100, items: [item('Date', 10, 100, 1), item('Description', 100, 100, 1), item('Amount', 250, 100, 1)], page: 1 },
      { y: 80, items: [item('01-Jan', 10, 80, 1), item('Test', 100, 80, 1), item('100.00', 250, 80, 1)], page: 1 },
      { y: 60, items: [item('02-Jan', 10, 60, 1), item('Test2', 100, 60, 1), item('101.00', 250, 60, 1)], page: 1 },
      // Page 2: different content at similar y-coordinates
      { y: 100, items: [item('Note', 10, 100, 2), item('Some', 100, 100, 2), item('Prose', 250, 100, 2)], page: 2 },
    ];
    const result = detectTableRegions(lines);
    expect(result.tableRegions).toHaveLength(1);
    expect(result.tableRegions[0].endLineIndex).toBe(3);
    expect(result.tableRegions[0].page).toBe(1);
  });

  it('includes noise-marker rows in the table region (noise filtering is downstream)', () => {
    const lines: Line[] = [
      { y: 100, items: [item('Date', 10, 100), item('Description', 100, 100), item('Amount', 250, 100)], page: 1 },
      { y: 80, items: [item('-', 10, 80), item('-', 100, 80), item('-', 250, 80)], page: 1 },
      { y: 60, items: [item('-', 10, 60), item('Opening Balance', 100, 60), item('49,154.62', 250, 60)], page: 1 },
      { y: 40, items: [item('01-Jan', 10, 40), item('Amazon', 100, 40), item('500.00', 250, 40)], page: 1 },
      { y: 20, items: [item('02-Jan', 10, 20), item('Flipkart', 100, 20), item('300.00', 250, 20)], page: 1 },
    ];
    const result = detectTableRegions(lines);
    expect(result.tableRegions).toHaveLength(1);
    // Region includes the Opening Balance row — noise filtering happens in row building
    expect(result.tableRegions[0].endLineIndex).toBe(5);
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
      { y: 80, items: [item('01-Jan', 10, 80), item('Amazon', 100, 80), item('500.00', 250, 80)], page: 1 },
      { y: 65, items: [item('02-Jan', 10, 65), item('Groceries', 100, 65), item('101.00', 250, 65)], page: 1 },
      // Gap from y=65 to y=10 is 55, vs prev gap of 15. 55 > 15*3=45 and > 30.
      { y: 10, items: [item('Disclaimer text', 10, 10)], page: 1 },
    ];
    const result = detectTableRegions(lines);
    expect(result.tableRegions).toHaveLength(1);
    expect(result.tableRegions[0].endLineIndex).toBe(3);
  });

  it('detects a region under the issuer header (TRANSACTION DESCRIPTION, REWARDS, AMOUNT)', () => {
    const lines = makeLines([
      [item('DATE & TIME', 10, 100), item('TRANSACTION DESCRIPTION', 90, 100), item('REWARDS', 260, 100), item('AMOUNT (IN ₹)', 340, 100)],
      [item('01-Jan', 10, 80), item('URBAN COMPANY LIMITED', 90, 80), item('+304', 260, 80), item('304.00', 340, 80)],
      [item('02-Jan', 10, 60), item('SWIGGY ORDER', 90, 60), item('-10', 260, 60), item('499.00', 340, 60)],
    ]);
    const result = detectTableRegions(lines);
    expect(result.tableRegions).toHaveLength(1);
    expect(result.tableRegions[0].startLineIndex).toBe(0);
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

  it('promotes a wrapped table (3 physical lines per row, issuer geometry)', () => {
    // Only the middle line of each row holds the date and the amount — the
    // old 50% density gate rejected this shape (~33%).
    const lines = makeLines([
      [item('DATE & TIME', 10, 100), item('TRANSACTION DESCRIPTION', 90, 100), item('REWARDS', 260, 100), item('AMOUNT (IN ₹)', 340, 100)],
      [item('URBAN COMPANY LIMITED', 90, 84)],
      [item('04/10/2025', 10, 78), item('+304', 260, 78), item('304.00', 340, 78)],
      [item('GURUGRAM IN', 90, 72)],
      [item('SWIGGY ORDER', 90, 56)],
      [item('05/10/2025', 10, 50), item('-10', 260, 50), item('499.00', 340, 50)],
      [item('BANGALORE IN', 90, 44)],
    ]);
    const result = detectTableRegions(lines);
    expect(result.tableRegions).toHaveLength(1);
  });

  it('promotes a wrapped table whose description lines embed number noise (the IGST row)', () => {
    // "RATE 18.0 -29" is not a date under the anchor predicates, but it IS
    // date-like under the old isDateLike — this pins that the row still
    // promotes with the noise line between the anchors.
    const lines = makeLines([
      [item('DATE & TIME', 10, 100), item('TRANSACTION DESCRIPTION', 90, 100), item('AMOUNT (IN ₹)', 340, 100)],
      [item('IGST-VPS2627827578828-RATE 18.0 -29 (Ref#', 90, 86)],
      [item('04/10/2025 00:00', 10, 82), item('12.35', 340, 82)],
      [item('VT252780075038360000183)', 90, 78)],
      [item('URBAN COMPANY LIMITED', 90, 64)],
      [item('05/10/2025 00:00', 10, 60), item('304.00', 340, 60)],
      [item('GURUGRAM IN', 90, 56)],
    ]);
    const result = detectTableRegions(lines);
    expect(result.tableRegions).toHaveLength(1);
  });

  it('rejects the IGST-shaped block when only the number-noise lines remain (no real dates)', () => {
    // If "RATE 18.0 -29" counted as a date, this two-row shape would promote.
    const lines = makeLines([
      [item('DATE & TIME', 10, 100), item('TRANSACTION DESCRIPTION', 90, 100), item('AMOUNT (IN ₹)', 340, 100)],
      [item('IGST-VPS2627827578828-RATE 18.0 -29 (Ref#', 90, 86), item('12.35', 340, 86)],
      [item('VT252780075038360000183)', 90, 78)],
      [item('CGST-VPS2627827578831-RATE 18.0 -29 (Ref#', 90, 64), item('12.35', 340, 64)],
      [item('VT252780075038360000184)', 90, 56)],
    ]);
    const result = detectTableRegions(lines);
    expect(result.tableRegions).toHaveLength(0);
  });

  it('promotes a table whose rows wrap to 4 physical lines (run of 3)', () => {
    const lines = makeLines([
      [item('Date', 10, 100), item('Description', 100, 100), item('Amount', 250, 100)],
      [item('01-Jan', 10, 90), item('100.00', 250, 90)],
      [item('cont1', 100, 85)],
      [item('cont2', 100, 80)],
      [item('cont3', 100, 75)],
      [item('02-Jan', 10, 60), item('101.00', 250, 60)],
      [item('cont4', 100, 55)],
    ]);
    const result = detectTableRegions(lines);
    expect(result.tableRegions).toHaveLength(1);
  });

  it('promotes a table whose rows wrap to 5 physical lines (run of 4, issuer intl rows)', () => {
    const lines = makeLines([
      [item('Date', 10, 100), item('Description', 100, 100), item('Amount', 250, 100)],
      [item('01-Jan', 10, 90), item('100.00', 250, 90)],
      [item('cont1', 100, 85)],
      [item('cont2', 100, 80)],
      [item('cont3', 100, 75)],
      [item('cont4', 100, 70)],
      [item('02-Jan', 10, 60), item('101.00', 250, 60)],
      [item('tail', 100, 50)],
    ]);
    const result = detectTableRegions(lines);
    expect(result.tableRegions).toHaveLength(1);
  });

  it('rejects a table whose rows wrap to 6 physical lines (run of 5)', () => {
    const lines = makeLines([
      [item('Date', 10, 100), item('Description', 100, 100), item('Amount', 250, 100)],
      [item('01-Jan', 10, 92), item('100.00', 250, 92)],
      [item('cont1', 100, 88)],
      [item('cont2', 100, 84)],
      [item('cont3', 100, 80)],
      [item('cont4', 100, 76)],
      [item('cont5', 100, 72)],
      [item('02-Jan', 10, 60), item('101.00', 250, 60)],
      [item('tail', 100, 50)],
    ]);
    const result = detectTableRegions(lines);
    expect(result.tableRegions).toHaveLength(0);
  });

  it('promotes a table followed by trailing summary lines (trailing run not counted)', () => {
    // Post-table block after the last anchor: the old 50% density gate saw
    // 2/8 = 25% and rejected; anchors' recurrence is what matters.
    const lines = makeLines([
      [item('Date', 10, 100), item('Description', 100, 100), item('Amount', 250, 100)],
      [item('01-Jan', 10, 90), item('Amazon', 100, 90), item('500.00', 250, 90)],
      [item('02-Jan', 10, 80), item('Groceries', 100, 80), item('200.00', 250, 80)],
      [item('Total Amount Due', 100, 70), item('98,154.62', 250, 70)],
      [item('Minimum Amount Due', 100, 65), item('4,907.00', 250, 65)],
      [item('Reward Points Summary', 100, 60)],
      [item('Opening 5000 Earned 320', 100, 55)],
      [item('Redeemed 0 Closing 5320', 100, 50)],
    ]);
    const result = detectTableRegions(lines);
    expect(result.tableRegions).toHaveLength(1);
  });

  it('rejects an amount-only block under a valid header (no date anchors)', () => {
    // The OLD density gate promoted this (100% amount density). Anchor
    // recurrence is required — this is the agreed narrowing, pinned.
    const lines = makeLines([
      [item('Date', 10, 100), item('Description', 100, 100), item('Amount', 250, 100)],
      [item('Previous Balance', 100, 90), item('49,154.62', 250, 90)],
      [item('Payments Received', 100, 80), item('8,000.00', 250, 80)],
      [item('Total Amount Due', 100, 70), item('98,154.62', 250, 70)],
    ]);
    const result = detectTableRegions(lines);
    expect(result.tableRegions).toHaveLength(0);
  });

  it('rejects prose where two dates are separated by a long gap', () => {
    const lines = makeLines([
      [item('Date', 10, 100), item('Description', 100, 100), item('Amount', 250, 100)],
      [item('01-Jan', 10, 80), item('note', 100, 80)],
      [item('prose line a', 100, 75)],
      [item('prose line b', 100, 70)],
      [item('prose line c', 100, 65)],
      [item('prose line d', 100, 60)],
      [item('prose line e', 100, 55)],
      [item('02-Jan', 10, 40), item('note', 100, 40)],
    ]);
    const result = detectTableRegions(lines);
    expect(result.tableRegions).toHaveLength(0);
  });

  it('rejects date-bearing prose whose date lines carry no amounts', () => {
    // Two date anchors, zero amounts — rule 3 (≥50% of anchors hold an
    // amount) must reject. The OLD density gate promoted this (100% dates).
    const lines = makeLines([
      [item('Date', 10, 100), item('Description', 100, 100), item('Amount', 250, 100)],
      [item('01-Jan', 10, 80), item('renewal notice', 100, 80)],
      [item('02-Jan', 10, 60), item('renewal notice', 100, 60)],
    ]);
    const result = detectTableRegions(lines);
    expect(result.tableRegions).toHaveLength(0);
  });

  it('rejects a table where only 1 of 3 anchor lines holds an amount (33% < 50%)', () => {
    const lines = makeLines([
      [item('Date', 10, 100), item('Description', 100, 100), item('Amount', 250, 100)],
      [item('01-Jan', 10, 90), item('Amazon', 100, 90), item('500.00', 250, 90)],
      [item('02-Jan', 10, 80), item('no amount printed', 100, 80)],
      [item('03-Jan', 10, 70), item('no amount printed', 100, 70)],
    ]);
    const result = detectTableRegions(lines);
    expect(result.tableRegions).toHaveLength(0);
  });

  it('promotes a yearless DD-MMM date column', () => {
    const lines = makeLines([
      [item('Date', 10, 100), item('Description', 100, 100), item('Amount', 250, 100)],
      [item('01-Jan', 10, 80), item('Amazon', 100, 80), item('500.00', 250, 80)],
      [item('02-Jan', 10, 60), item('Groceries', 100, 60), item('200.00', 250, 60)],
    ]);
    const result = detectTableRegions(lines);
    expect(result.tableRegions).toHaveLength(1);
  });

  it('rejects a single-row region (anchor minimum is 2)', () => {
    const lines = makeLines([
      [item('Date', 10, 100), item('Description', 100, 100), item('Amount', 250, 100)],
      [item('01-Jan', 10, 80), item('Amazon', 100, 80), item('500.00', 250, 80)],
    ]);
    const result = detectTableRegions(lines);
    expect(result.tableRegions).toHaveLength(0);
  });
});
