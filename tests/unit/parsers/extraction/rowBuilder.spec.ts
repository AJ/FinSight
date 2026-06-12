import { describe, it, expect } from 'vitest';
import { buildTransactionRows, splitMergedLines } from '@/lib/parsers/extraction/rowBuilder';
import type { AssignedLine, ColumnSchema, ColumnDef } from '@/lib/parsers/extraction/extractionTypes';

function makeAssignedLine(
  texts: string[],
  y: number,
  regionIndex: number,
  isHeader: boolean = false,
  page: number = 1,
): AssignedLine {
  return {
    line: {
      y,
      items: texts.map((t, i) => ({
        text: t,
        x: i * 100,
        right: i * 100 + t.length * 6,
        y,
        page,
      })),
      page,
    },
    assignments: texts.map((_, i) => i),
    isHeader,
    regionIndex,
  };
}

function makeSchema(numCols: number, dateColIdx: number = 0, regionIndex: number = 0): ColumnSchema {
  return {
    columns: Array.from({ length: numCols }, (_, i) => ({
      index: i,
      headerText: `Col${i}`,
      columnLeft: i * 100,
      columnRight: (i + 1) * 100,
      type: 'unknown' as const,
    })),
    dateColumnIndex: dateColIdx,
    sourceRegionIndex: regionIndex,
  };
}

describe('buildTransactionRows', () => {
  it('creates one row per line for single-line transactions', () => {
    const lines = [
      makeAssignedLine(['01-Jan', 'Amazon', '500'], 100, 0),
      makeAssignedLine(['02-Jan', 'Groceries', '200'], 80, 0),
    ];
    const schemas = [makeSchema(3, 0, 0)];

    const result = buildTransactionRows(lines, schemas);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].columnValues).toEqual(['01-Jan', 'Amazon', '500']);
    expect(result.rows[1].columnValues).toEqual(['02-Jan', 'Groceries', '200']);
  });

  it('merges continuation lines without a date into the previous transaction', () => {
    const lines = [
      makeAssignedLine(['01-Jan', 'Amazon Purchase', '500'], 100, 0),
      makeAssignedLine(['', 'Marketplace India', ''], 80, 0),
    ];
    const schemas = [makeSchema(3, 0, 0)];

    const { rows } = buildTransactionRows(lines, schemas);
    expect(rows).toHaveLength(1);
    expect(rows[0].columnValues[1]).toContain('Amazon Purchase');
    expect(rows[0].columnValues[1]).toContain('Marketplace India');
  });

  it('starts new row when date appears in date column', () => {
    const lines = [
      makeAssignedLine(['01-Jan', 'Amazon', '500'], 100, 0),
      makeAssignedLine(['02-Jan', 'Groceries', '200'], 80, 0),
    ];
    const schemas = [makeSchema(3, 0, 0)];

    const { rows } = buildTransactionRows(lines, schemas);
    expect(rows).toHaveLength(2);
  });

  it('skips noise marker rows like Opening Balance', () => {
    const lines = [
      makeAssignedLine(['01-Jan-2026', 'Opening Balance', '50000'], 100, 0),
      makeAssignedLine(['02-Jan', 'Test', '100'], 80, 0),
    ];
    const schemas = [makeSchema(3, 0, 0)];

    const { rows } = buildTransactionRows(lines, schemas);
    expect(rows).toHaveLength(1);
    expect(rows[0].columnValues[1]).toBe('Test');
  });

  it('does not merge across region boundaries', () => {
    const lines = [
      makeAssignedLine(['01-Jan', 'Transaction', '100'], 100, 0),
      makeAssignedLine(['', 'Continuation', ''], 80, 1),
    ];
    const schemas = [makeSchema(3, 0, 0), makeSchema(3, 0, 1)];

    const { rows } = buildTransactionRows(lines, schemas);
    expect(rows).toHaveLength(2);
  });

  it('includes header lines as rows in the output', () => {
    const lines = [
      makeAssignedLine(['Date', 'Description', 'Amount'], 120, 0, true),
      makeAssignedLine(['01-Jan', 'Test', '100'], 100, 0),
    ];
    const schemas = [makeSchema(3, 0, 0)];

    const { rows } = buildTransactionRows(lines, schemas);
    expect(rows).toHaveLength(2); // header + 1 data row
    expect(rows[0].columnValues[0]).toBe('Date');
    expect(rows[1].columnValues[0]).toBe('01-Jan');
  });

  it('uses dateColumnIndex from schema, not hardcoded column 0', () => {
    // Date is in column 1, not column 0
    const lines = [
      makeAssignedLine(['1', '01-Jan', 'Amazon', '500'], 100, 0),
      makeAssignedLine(['', '', 'Marketplace India', ''], 85, 0), // no date in col 1 → continuation
      makeAssignedLine(['2', '02-Jan', 'Groceries', '200'], 60, 0), // date in col 1 → new row
    ];
    const schemas = [makeSchema(4, 1, 0)]; // dateColumnIndex = 1

    const { rows } = buildTransactionRows(lines, schemas);
    expect(rows).toHaveLength(2);
    expect(rows[0].columnValues[2]).toContain('Amazon');
    expect(rows[0].columnValues[2]).toContain('Marketplace India');
    expect(rows[1].columnValues[2]).toBe('Groceries');
  });

  it('skips opening noise marker variants without ending table', () => {
    const markers = ['Opening Balance', 'Brought Forward'];
    for (const marker of markers) {
      const lines = [
        makeAssignedLine(['01-Jan-2026', marker, '50000'], 100, 0),
        makeAssignedLine(['02-Jan', 'Test', '100'], 80, 0),
      ];
      const { rows } = buildTransactionRows(lines, [makeSchema(3, 0, 0)]);
      expect(rows).toHaveLength(1);
      expect(rows[0].columnValues[1]).toBe('Test');
    }
  });

  it('ends table on closing noise marker variants', () => {
    const markers = ['Closing Balance', 'Carried Forward'];
    for (const marker of markers) {
      const lines = [
        makeAssignedLine(['01-Jan', 'Transaction', '100'], 100, 0),
        makeAssignedLine(['02-Jan', marker, '50000'], 80, 0),
        makeAssignedLine(['03-Jan', 'AfterClose', '200'], 60, 0),
      ];
      const { rows } = buildTransactionRows(lines, [makeSchema(3, 0, 0)]);
      expect(rows).toHaveLength(1);
      expect(rows[0].columnValues[1]).toBe('Transaction');
    }
  });

  it('filters noise rows even when they contain a date', () => {
    const lines = [
      makeAssignedLine(['01-Jan', 'Opening Balance', '50000'], 100, 0),
      makeAssignedLine(['02-Jan', 'Test', '100'], 80, 0),
    ];
    const schemas = [makeSchema(3, 0, 0)];
    const { rows } = buildTransactionRows(lines, schemas);
    expect(rows).toHaveLength(1);
    expect(rows[0].columnValues[1]).toBe('Test');
  });

  it('skips lines with empty assignments', () => {
    const lines = [
      makeAssignedLine(['01-Jan', 'Amazon', '500'], 100, 0),
      { line: { y: 90, items: [{ text: 'orphan', x: 0, right: 30, y: 90, page: 1 }], page: 1 }, assignments: [], isHeader: false, regionIndex: 0 },
      makeAssignedLine(['02-Jan', 'Groceries', '200'], 80, 0),
    ];
    const schemas = [makeSchema(3, 0, 0)];

    const { rows } = buildTransactionRows(lines, schemas);
    expect(rows).toHaveLength(2);
    expect(rows[0].columnValues[1]).toBe('Amazon');
    expect(rows[1].columnValues[1]).toBe('Groceries');
  });

  it('concatenates multi-value cells in continuation lines', () => {
    // First line fills col 1 with "Amazon", continuation appends " India Pvt Ltd"
    const lines = [
      makeAssignedLine(['01-Jan', 'Amazon', '500'], 100, 0),
      makeAssignedLine(['', 'India Pvt Ltd', ''], 85, 0),
      makeAssignedLine(['02-Jan', 'Groceries', '200'], 60, 0),
    ];
    const schemas = [makeSchema(3, 0, 0)];

    const { rows } = buildTransactionRows(lines, schemas);
    expect(rows).toHaveLength(2);
    expect(rows[0].columnValues[1]).toBe('Amazon India Pvt Ltd');
  });

  it('defaults to column 0 for date when no schema matches the region', () => {
    // Region 1 has no schema — dateColumnIndex falls back to 0.
    // First line has date in col 0 → starts a new row.
    // Second line has date in col 1 but fallback checks col 0 (empty) → no date → continuation.
    const lines = [
      makeAssignedLine(['01-Jan', '', '100'], 100, 1),
      makeAssignedLine(['', '02-Jan', '200'], 80, 1),
    ];
    // Only schema for region 0, not region 1
    const schemas = [makeSchema(3, 0, 0)];

    const { rows } = buildTransactionRows(lines, schemas);
    // Second line merged into first because fallback checks col 0 (empty), not col 1 (date)
    expect(rows).toHaveLength(1);
    expect(rows[0].columnValues[0]).toBe('01-Jan');
    expect(rows[0].columnValues[1]).toBe('02-Jan');
  });

  it('returns empty rows for empty input', () => {
    expect(buildTransactionRows([], []).rows).toEqual([]);
  });
});

describe('buildTransactionRows — continuation assignment', () => {
  it('assigns continuation above next anchor to the next row', () => {
    // Row A (y=100): date + "B/F" + balance
    // Continuation (y=95): description text (no date) — above midpoint(100,90)=95
    // Row B (y=90): date + description + amount + balance
    // The continuation at y=95 should go to row B (y=95 <= midpoint=95)
    const lines = [
      makeAssignedLine(['01-Jan', 'B/F', '34,183.35'], 100, 0),
      makeAssignedLine(['', 'UPI/CRED Club/AXIS', ''], 95, 0),
      makeAssignedLine(['02-Jan', 'BANK/176226', '3,399.05', '30,784.30'], 90, 0),
    ];
    const schemas = [makeSchema(4, 0, 0)];

    const { rows } = buildTransactionRows(lines, schemas);
    // The UPI/CRED description should be in the second transaction, not the first
    const upiRow = rows.find(r => r.columnValues[1]?.includes('UPI/CRED'));
    expect(upiRow).toBeDefined();
    expect(upiRow!.columnValues[1]).toContain('UPI/CRED Club/AXIS');
    // The B/F row should NOT contain UPI/CRED text
    const bfRow = rows.find(r => r.columnValues[1]?.includes('B/F'));
    if (bfRow) {
      expect(bfRow.columnValues[1]).not.toContain('UPI/CRED');
    }
  });

  it('keeps normal continuation (below anchor) in the previous row', () => {
    // Row A (y=100): date + description first part
    // Continuation (y=91): description second part — above midpoint(100,80)=90
    // Row B (y=80): date + description
    // Continuation at y=91 should stay with row A (91 > midpoint=90)
    const lines = [
      makeAssignedLine(['01-Jan', 'Amazon Purchase', '500'], 100, 0),
      makeAssignedLine(['', 'India Pvt Ltd', ''], 91, 0),
      makeAssignedLine(['02-Jan', 'Groceries', '200'], 80, 0),
    ];
    const schemas = [makeSchema(3, 0, 0)];

    const { rows } = buildTransactionRows(lines, schemas);
    expect(rows).toHaveLength(2);
    expect(rows[0].columnValues[1]).toBe('Amazon Purchase India Pvt Ltd');
  });

  it('splits multiple continuations across the midpoint boundary', () => {
    // Row A (y=100): date + desc
    // Cont1 (y=96): description — above midpoint(100,90)=95 → previous row
    // Cont2 (y=93): description — below midpoint=95 → next row
    // Cont3 (y=91): description — below midpoint=95 → next row
    // Row B (y=90): date + desc
    const lines = [
      makeAssignedLine(['01-Jan', 'Amazon', '500'], 100, 0),
      makeAssignedLine(['', 'Marketplace', ''], 96, 0),
      makeAssignedLine(['', 'UPI/CRED Club', ''], 93, 0),
      makeAssignedLine(['', 'AXIS payment', ''], 91, 0),
      makeAssignedLine(['02-Jan', 'Groceries', '200'], 90, 0),
    ];
    const schemas = [makeSchema(3, 0, 0)];

    const { rows } = buildTransactionRows(lines, schemas);
    expect(rows).toHaveLength(2);
    // Cont1 (y=96 > 95) appended to row A
    expect(rows[0].columnValues[1]).toBe('Amazon Marketplace');
    // Cont2 (y=93) and Cont3 (y=91) prepended to row B in top-to-bottom order
    expect(rows[1].columnValues[1]).toBe('UPI/CRED Club AXIS payment Groceries');
  });
});

// Helper for splitMergedLines tests — creates schema with typed columns
function makeTypedSchema(
  cols: { header: string; type: ColumnDef['type'] }[],
  dateColIdx: number = 0,
  regionIndex: number = 0,
): ColumnSchema {
  return {
    columns: cols.map((c, i) => ({
      index: i,
      headerText: c.header,
      columnLeft: i * 100,
      columnRight: (i + 1) * 100,
      type: c.type,
    })),
    dateColumnIndex: dateColIdx,
    sourceRegionIndex: regionIndex,
  };
}

describe('splitMergedLines', () => {
  it('splits a merged line with items from two rows', () => {
    // Line has items from row A (y=100) and row B (y=80), both in date column
    const merged: AssignedLine[] = [
      {
        line: {
          y: 100,
          items: [
            { text: '01-Jan', x: 0, right: 40, y: 100, page: 1 },
            { text: 'Amazon', x: 100, right: 150, y: 100, page: 1 },
            { text: '02-Feb', x: 0, right: 40, y: 80, page: 1 },
            { text: 'Groceries', x: 100, right: 160, y: 80, page: 1 },
          ],
          page: 1,
        },
        assignments: [0, 1, 0, 1],
        isHeader: false,
        regionIndex: 0,
      },
    ];
    const schemas = [makeTypedSchema([
      { header: 'Date', type: 'date' },
      { header: 'Description', type: 'description' },
    ])];

    const result = splitMergedLines(merged, schemas);
    expect(result).toHaveLength(2);
    expect(result[0].line.items.map(i => i.text)).toEqual(['01-Jan', 'Amazon']);
    expect(result[1].line.items.map(i => i.text)).toEqual(['02-Feb', 'Groceries']);
  });

  it('passes through when no splitting is needed', () => {
    const lines: AssignedLine[] = [
      makeAssignedLine(['01-Jan', 'Amazon', '500'], 100, 0),
    ];
    const schemas = [makeTypedSchema([
      { header: 'Date', type: 'date' },
      { header: 'Description', type: 'description' },
      { header: 'Amount', type: 'amount' },
    ])];

    const result = splitMergedLines(lines, schemas);
    expect(result).toHaveLength(1);
    expect(result[0].line.items.map(i => i.text)).toEqual(['01-Jan', 'Amazon', '500']);
  });

  it('passes through header lines unchanged', () => {
    const header: AssignedLine[] = [
      {
        line: {
          y: 120,
          items: [
            { text: 'Date', x: 0, right: 30, y: 120, page: 1 },
            { text: 'Description', x: 100, right: 170, y: 120, page: 1 },
          ],
          page: 1,
        },
        assignments: [0, 1],
        isHeader: true,
        regionIndex: 0,
      },
    ];
    const schemas = [makeTypedSchema([
      { header: 'Date', type: 'date' },
      { header: 'Description', type: 'description' },
    ])];

    const result = splitMergedLines(header, schemas);
    expect(result).toHaveLength(1);
    expect(result[0].isHeader).toBe(true);
  });

  it('passes through when no schema matches region', () => {
    const lines: AssignedLine[] = [
      makeAssignedLine(['01-Jan', 'Amazon'], 100, 99),
    ];

    const result = splitMergedLines(lines, []);
    expect(result).toHaveLength(1);
  });

  it('uses multi-column anchors for boundary detection', () => {
    // Date and balance columns provide anchors at different y-positions
    const merged: AssignedLine[] = [
      {
        line: {
          y: 200,
          items: [
            { text: '01-Jan', x: 0, right: 40, y: 200, page: 1 },    // col 0 (date)
            { text: '500', x: 100, right: 130, y: 200, page: 1 },     // col 1 (description)
            { text: '34,183.35', x: 200, right: 260, y: 200, page: 1 }, // col 2 (balance)
            { text: '02-Feb', x: 0, right: 40, y: 180, page: 1 },    // col 0 (date) — row B
            { text: 'desc', x: 100, right: 130, y: 180, page: 1 },   // col 1 (description) — row B
            { text: '30,784', x: 200, right: 260, y: 180, page: 1 },  // col 2 (balance) — row B
          ],
          page: 1,
        },
        assignments: [0, 1, 2, 0, 1, 2],
        isHeader: false,
        regionIndex: 0,
      },
    ];
    const schemas = [makeTypedSchema([
      { header: 'Date', type: 'date' },
      { header: 'Particulars', type: 'description' },
      { header: 'Balance', type: 'balance' },
    ])];

    const result = splitMergedLines(merged, schemas);
    expect(result).toHaveLength(2);
    expect(result[0].line.items).toHaveLength(3);
    expect(result[1].line.items).toHaveLength(3);
  });

  it('clusters nearby anchor y-positions', () => {
    // Two date items at y=100.0 and y=100.5 (within 2px) → same cluster
    const merged: AssignedLine[] = [
      {
        line: {
          y: 100,
          items: [
            { text: '01-Jan', x: 0, right: 40, y: 100.0, page: 1 },
            { text: 'desc1', x: 100, right: 140, y: 100.3, page: 1 },
            { text: '02-Feb', x: 0, right: 40, y: 100.5, page: 1 },
            { text: 'desc2', x: 100, right: 140, y: 100.2, page: 1 },
          ],
          page: 1,
        },
        assignments: [0, 1, 0, 1],
        isHeader: false,
        regionIndex: 0,
      },
    ];
    const schemas = [makeTypedSchema([
      { header: 'Date', type: 'date' },
      { header: 'Description', type: 'description' },
    ])];

    const result = splitMergedLines(merged, schemas);
    // All anchors within 2px → single cluster → no split
    expect(result).toHaveLength(1);
  });

  it('returns input unchanged for empty input', () => {
    expect(splitMergedLines([], [])).toEqual([]);
  });
});

// ── isSummaryRow (tested via buildTransactionRows) ──

describe('buildTransactionRows — isSummaryRow detection', () => {
  it('detects a structural summary row (no date + multiple amounts) and ends the region', () => {
    // A row with no date and amounts in two columns → structural summary detection
    const lines = [
      makeAssignedLine(['01-Jan', 'Transaction', '100', ''], 100, 0),
      makeAssignedLine(['', '', '5000.00', '3000.00'], 80, 0), // no date, 2 amounts → summary
      makeAssignedLine(['02-Jan', 'AfterSummary', '200', ''], 60, 0),
    ];
    const schemas = [makeSchema(4, 0, 0)];

    const { rows } = buildTransactionRows(lines, schemas);
    // Summary row ends the region; line after summary is post-table
    expect(rows).toHaveLength(1);
    expect(rows[0].columnValues[1]).toBe('Transaction');
  });

  it('does not classify a row with a date as a summary row', () => {
    // Even with multiple amounts, a date means it's a transaction, not a summary
    const lines = [
      makeAssignedLine(['01-Jan', 'Transaction', '100', ''], 100, 0),
      makeAssignedLine(['02-Jan', 'Normal Row', '5000.00', '3000.00'], 80, 0),
    ];
    const schemas = [makeSchema(4, 0, 0)];

    const { rows } = buildTransactionRows(lines, schemas);
    expect(rows).toHaveLength(2);
    expect(rows[1].columnValues[1]).toBe('Normal Row');
  });

  it('does not misclassify continuation lines with multiple amounts as summary rows', () => {
    // CRITICAL REGRESSION TEST: A continuation line (no date, current row exists, same region)
    // with amounts in multiple columns must NOT trigger isSummaryRow.
    // The improved isSummaryRow requires ALL non-empty non-date values to be numeric;
    // a continuation with description text like "continued" fails that check.
    const lines = [
      makeAssignedLine(['01-Jan', 'Transaction', '500', ''], 100, 0),
      makeAssignedLine(['', 'continued', '200', '800'], 92, 0), // continuation with text + 2 amounts
      makeAssignedLine(['02-Jan', 'Next Txn', '300', ''], 80, 0),
    ];
    const schemas = [makeSchema(4, 0, 0)];

    const { rows } = buildTransactionRows(lines, schemas);
    // All 3 lines produce 2 rows — continuation merges into row 1, table does NOT end
    expect(rows).toHaveLength(2);
    expect(rows[0].columnValues[1]).toContain('Transaction');
    expect(rows[0].columnValues[1]).toContain('continued');
    expect(rows[1].columnValues[1]).toBe('Next Txn');
  });

  it('does not classify a line with only one numeric value as a summary row', () => {
    // One numeric value below the threshold (≥2 required)
    const lines = [
      makeAssignedLine(['01-Jan', 'Transaction', '100', ''], 100, 0),
      makeAssignedLine(['', '', '5000.00', ''], 80, 0), // only 1 amount
      makeAssignedLine(['02-Jan', 'Next', '200', ''], 60, 0),
    ];
    const schemas = [makeSchema(4, 0, 0)];

    const { rows } = buildTransactionRows(lines, schemas);
    // Single-amount line is not a summary — it's a continuation
    expect(rows).toHaveLength(2);
  });
});

// ── postTableLines ──

describe('buildTransactionRows — postTableLines', () => {
  it('collects lines after closing marker as postTableLines', () => {
    const lines = [
      makeAssignedLine(['01-Jan', 'Transaction', '100'], 100, 0),
      makeAssignedLine(['02-Jan', 'Closing Balance', '50000'], 80, 0),
      makeAssignedLine(['', 'Statement generated on 01-Feb', ''], 60, 0),
    ];
    const schemas = [makeSchema(3, 0, 0)];

    const { rows, postTableLines } = buildTransactionRows(lines, schemas);
    expect(rows).toHaveLength(1);
    expect(postTableLines).toHaveLength(1);
    expect(postTableLines[0].line.items[1].text).toContain('Statement generated');
  });

  it('collects lines after summary row as postTableLines', () => {
    const lines = [
      makeAssignedLine(['01-Jan', 'Transaction', '100', ''], 100, 0),
      makeAssignedLine(['', '', '5000.00', '3000.00'], 80, 0), // summary row (all numeric, no text)
      makeAssignedLine(['', 'Footer text', '', ''], 60, 0),
    ];
    const schemas = [makeSchema(4, 0, 0)];

    const { rows, postTableLines } = buildTransactionRows(lines, schemas);
    expect(rows).toHaveLength(1);
    expect(postTableLines).toHaveLength(1);
    expect(postTableLines[0].line.items[1].text).toBe('Footer text');
  });

  it('returns empty postTableLines when no closing marker is encountered', () => {
    const lines = [
      makeAssignedLine(['01-Jan', 'Transaction', '100'], 100, 0),
      makeAssignedLine(['02-Jan', 'Another', '200'], 80, 0),
    ];
    const schemas = [makeSchema(3, 0, 0)];

    const { postTableLines } = buildTransactionRows(lines, schemas);
    expect(postTableLines).toHaveLength(0);
  });

  it('only collects post-table lines for the ended region, not other regions', () => {
    // Region 0 ends with closing marker; region 1 continues
    const lines = [
      makeAssignedLine(['01-Jan', 'Txn A', '100'], 100, 0),
      makeAssignedLine(['02-Jan', 'Closing Balance', '50000'], 80, 0),
      makeAssignedLine(['', 'Region 0 footer', ''], 60, 0),
      makeAssignedLine(['01-Jan', 'Txn B', '200'], 100, 1),
      makeAssignedLine(['02-Jan', 'Txn C', '300'], 80, 1),
    ];
    const schemas = [makeSchema(3, 0, 0), makeSchema(3, 0, 1)];

    const { rows, postTableLines } = buildTransactionRows(lines, schemas);
    // Region 0: 1 row + 1 post-table line; Region 1: 2 rows
    expect(rows).toHaveLength(3);
    // Only the region 0 footer should be in postTableLines
    expect(postTableLines).toHaveLength(1);
    expect(postTableLines[0].line.items[1].text).toBe('Region 0 footer');
  });
});

// ── TableRegionMeta ──

describe('buildTransactionRows — TableRegionMeta', () => {
  it('tracks startY from opening noise row and endY from closing marker', () => {
    const lines = [
      makeAssignedLine(['01-Jan-2026', 'Opening Balance', '50000'], 120, 0),
      makeAssignedLine(['02-Jan', 'Transaction', '100'], 100, 0),
      makeAssignedLine(['03-Jan', 'Closing Balance', '50100'], 80, 0),
    ];
    const schemas = [makeSchema(3, 0, 0)];

    const { regionMeta } = buildTransactionRows(lines, schemas);
    expect(regionMeta.size).toBe(1);
    const meta = regionMeta.get(0)!;
    expect(meta.started).toBe(true);
    expect(meta.ended).toBe(true);
    expect(meta.startY).toBe(120); // opening balance y
    expect(meta.endY).toBe(80);    // closing balance y
  });

  it('tracks startY from first data row when no opening marker', () => {
    const lines = [
      makeAssignedLine(['01-Jan', 'Transaction', '100'], 100, 0),
      makeAssignedLine(['02-Jan', 'Another', '200'], 80, 0),
    ];
    const schemas = [makeSchema(3, 0, 0)];

    const { regionMeta } = buildTransactionRows(lines, schemas);
    const meta = regionMeta.get(0)!;
    expect(meta.started).toBe(true);
    expect(meta.startY).toBe(100); // first data row y
  });

  it('sets endY to last anchor y when no closing marker', () => {
    const lines = [
      makeAssignedLine(['01-Jan', 'Transaction', '100'], 100, 0),
      makeAssignedLine(['02-Jan', 'Another', '200'], 80, 0),
    ];
    const schemas = [makeSchema(3, 0, 0)];

    const { regionMeta } = buildTransactionRows(lines, schemas);
    const meta = regionMeta.get(0)!;
    expect(meta.ended).toBe(false);
    expect(meta.endY).toBe(80); // last anchor y (fallback)
  });

  it('tracks pages spanned by region', () => {
    const lines = [
      makeAssignedLine(['01-Jan', 'Txn A', '100'], 100, 0, false, 1),
      makeAssignedLine(['02-Jan', 'Txn B', '200'], 80, 0, false, 2),
      makeAssignedLine(['03-Jan', 'Txn C', '300'], 60, 0, false, 3),
    ];
    const schemas = [makeSchema(3, 0, 0)];

    const { regionMeta } = buildTransactionRows(lines, schemas);
    const meta = regionMeta.get(0)!;
    expect(meta.pages).toEqual(new Set([1, 2, 3]));
  });

  it('maintains independent ended flag per region', () => {
    // Region 0 has closing marker; region 1 does not
    const lines = [
      makeAssignedLine(['01-Jan', 'Txn A', '100'], 100, 0),
      makeAssignedLine(['02-Jan', 'Closing Balance', '50000'], 80, 0),
      makeAssignedLine(['01-Jan', 'Txn B', '200'], 100, 1),
      makeAssignedLine(['02-Jan', 'Txn C', '300'], 80, 1),
    ];
    const schemas = [makeSchema(3, 0, 0), makeSchema(3, 0, 1)];

    const { regionMeta } = buildTransactionRows(lines, schemas);
    expect(regionMeta.get(0)!.ended).toBe(true);
    expect(regionMeta.get(1)!.ended).toBe(false);
  });

  it('derives x-bounds from schema columns', () => {
    // Schema with columns at x=0,100,200 — startX=0, endX=300
    const lines = [
      makeAssignedLine(['01-Jan', 'Txn', '100'], 100, 0),
    ];
    const schemas = [makeSchema(3, 0, 0)];

    const { regionMeta } = buildTransactionRows(lines, schemas);
    const meta = regionMeta.get(0)!;
    expect(meta.startX).toBe(0);
    expect(meta.endX).toBe(300);
  });
});

// ── "Total" closing marker + exact-match negatives ──

describe('buildTransactionRows — Total marker and exact-match', () => {
  it('ends table on exact "Total" marker', () => {
    const lines = [
      makeAssignedLine(['01-Jan', 'Transaction', '100'], 100, 0),
      makeAssignedLine(['', 'Total', '5000'], 80, 0),
      makeAssignedLine(['02-Jan', 'AfterTotal', '200'], 60, 0),
    ];
    const schemas = [makeSchema(3, 0, 0)];

    const { rows } = buildTransactionRows(lines, schemas);
    expect(rows).toHaveLength(1);
    expect(rows[0].columnValues[1]).toBe('Transaction');
  });

  it('does NOT end table on "Total gas purchase" (substring false positive)', () => {
    // "Total" appears as a substring but is NOT an exact/standalone match
    const lines = [
      makeAssignedLine(['01-Jan', 'Transaction', '100'], 100, 0),
      makeAssignedLine(['02-Jan', 'Total gas purchase', '5000'], 80, 0),
      makeAssignedLine(['03-Jan', 'Another', '200'], 60, 0),
    ];
    const schemas = [makeSchema(3, 0, 0)];

    const { rows } = buildTransactionRows(lines, schemas);
    expect(rows).toHaveLength(3);
    expect(rows[1].columnValues[1]).toBe('Total gas purchase');
  });

  it('does NOT end table on "Total:" with trailing punctuation (normalized match)', () => {
    // "Total:" normalizes to "Total" after trimming trailing punctuation
    const lines = [
      makeAssignedLine(['01-Jan', 'Transaction', '100'], 100, 0),
      makeAssignedLine(['', 'Total:', '5000'], 80, 0),
      makeAssignedLine(['02-Jan', 'After', '200'], 60, 0),
    ];
    const schemas = [makeSchema(3, 0, 0)];

    const { rows } = buildTransactionRows(lines, schemas);
    // "Total:" normalizes to "total" → exact closing marker → ends table
    expect(rows).toHaveLength(1);
  });

  it('does NOT end table on "Total Energies" (multi-word, not standalone)', () => {
    const lines = [
      makeAssignedLine(['01-Jan', 'Transaction', '100'], 100, 0),
      makeAssignedLine(['02-Jan', 'Total Energies Fuel', '5000'], 80, 0),
      makeAssignedLine(['03-Jan', 'Another', '200'], 60, 0),
    ];
    const schemas = [makeSchema(3, 0, 0)];

    const { rows } = buildTransactionRows(lines, schemas);
    expect(rows).toHaveLength(3);
    expect(rows[1].columnValues[1]).toBe('Total Energies Fuel');
  });
});
