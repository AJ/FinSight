import { describe, it, expect } from 'vitest';
import { deriveMergeTolerance, groupOverlapping, detectColumnStacks, MIN_HEADERLESS_ROWS } from '@/lib/parsers/extraction/stackDetector';
import type { Line, RawTextItem } from '@/lib/parsers/extraction/extractionTypes';

describe('deriveMergeTolerance', () => {
  it('is the median body font height (the glyph scale)', () => {
    expect(deriveMergeTolerance([7, 7, 8, 7])).toBe(7);
    expect(deriveMergeTolerance([9])).toBe(9);
  });

  it('floors at 1 so a zero-height PDF cannot collapse the tolerance', () => {
    expect(deriveMergeTolerance([])).toBe(1);
    expect(deriveMergeTolerance([0, 0, 0])).toBe(1);
  });
});

describe('groupOverlapping', () => {
  const span = (x: number, right: number) => ({ x, right });

  it('merges spans that overlap (right-aligned amounts share a right edge)', () => {
    const groups = groupOverlapping([span(100, 200), span(140, 200), span(95, 190)], 2);
    expect(groups).toHaveLength(1);
  });

  it('keeps groups apart across a gap larger than the tolerance', () => {
    const groups = groupOverlapping([span(10, 40), span(100, 140), span(12, 38)], 5);
    expect(groups).toHaveLength(2);
  });

  it('merges near-touching spans within the tolerance (flush badge)', () => {
    const groups = groupOverlapping([span(10, 40), span(43, 55)], 5);
    expect(groups).toHaveLength(1);
  });

  it('does not merge when the gap exceeds the tolerance', () => {
    const groups = groupOverlapping([span(10, 40), span(43, 55)], 2);
    expect(groups).toHaveLength(2);
  });
});

// ─── Full detection (spec Part 1) ─────────────────────────────────────────────

function item(text: string, x: number, right: number): RawTextItem {
  return { text, x, right, y: 0, page: 1, height: 9 };
}
function line(items: RawTextItem[]): Line {
  return { y: 0, items, page: 1 };
}
/** N data rows of [date(10-40), badge zone(52-60), desc(70-150), amount(170-200)] plus header. */
function makeRows(n: number, badgeRows: number[] = []): { header: Line; rows: Line[] } {
  const header = line([item('DATE', 10, 40), item('DESCRIPTION', 70, 150), item('AMOUNT', 170, 200)]);
  const rows: Line[] = [];
  for (let i = 0; i < n; i++) {
    const items = [item(`01/0${(i % 8) + 1}/2025`, 10, 40), item(`MERCHANT ${i}`, 70, 130), item(`${100 + i}.00`, 172, 200)];
    if (badgeRows.includes(i)) items.push(item('EMI', 52, 60)); // gaps 12 and 10 — wider than the 9px tolerance
    rows.push(line(items));
  }
  return { header, rows };
}

describe('detectColumnStacks', () => {
  it('finds the named columns and gives each its header text and concept', () => {
    const { header, rows } = makeRows(10);
    const r = detectColumnStacks(header, rows);
    expect(r.stacks.map(s => s.headerText)).toEqual(['DATE', 'DESCRIPTION', 'AMOUNT']);
    expect(r.stacks.map(s => s.concept)).toEqual(['date', 'description', 'amount']);
    expect(r.stacks[0].left).toBe(10);
    expect(r.stacks[2].right).toBe(200);
    expect(r.twoHeaderCollision).toBe(false);
  });

  it('carves a badge stretch (minority coverage) into its own headerless column', () => {
    // Badges at 52-60 on 6 of 30 rows, with gaps wider than the tolerance on
    // both sides (the real statement's badge sits 11 and 33px from its
    // neighbours). The date column must end at 40; the badge becomes its own
    // headerless stack covering 6 rows.
    const { header, rows } = makeRows(30, [2, 5, 9, 14, 20, 27]);
    const r = detectColumnStacks(header, rows);
    const badge = r.stacks.find(s => s.headerText === null);
    expect(badge).toBeDefined();
    expect(badge!.left).toBeGreaterThanOrEqual(52);
    expect(badge!.coverageRows).toBe(6);
    const date = r.stacks.find(s => s.headerText === 'DATE');
    expect(date!.right).toBe(40);
  });

  it('keeps a sparse named column whole (REWARDS on a third of rows)', () => {
    // A standalone rewards group: header + values on 8 of 30 rows. It has no
    // majority stretch of its own — it must stay one column, not be carved
    // or dropped.
    const header = line([item('DATE', 10, 40), item('REWARDS', 220, 260)]);
    const rows: Line[] = [];
    for (let i = 0; i < 30; i++) {
      const items = [item(`01/0${(i % 8) + 1}/2025`, 10, 40)];
      if (i % 4 === 0) items.push(item(`+${i}`, 235, 255));
      rows.push(line(items));
    }
    const r = detectColumnStacks(header, rows);
    const rewards = r.stacks.find(s => s.headerText === 'REWARDS');
    expect(rewards).toBeDefined();
    expect(rewards!.coverageRows).toBe(9); // 8 data rows + header row
  });

  it('right-aligned amounts with spreading widths stay one column', () => {
    const header = line([item('AMOUNT', 100, 200)]);
    const rows: Line[] = [];
    const widths = [100, 130, 160, 190, 220, 250, 280, 310, 340];
    for (let i = 0; i < 9; i++) {
      rows.push(line([item(`${i}.00`, 200 - widths[i], 200)]));
    }
    const r = detectColumnStacks(header, rows);
    expect(r.stacks).toHaveLength(1);
  });

  it('a TOUCHING badge stays inside the date column (gap thinner than the tolerance is one cell)', () => {
    // 3 rows, every row badged, badge starting exactly at the date column's
    // right edge. The seam is thinner than the tolerance and no header sits
    // over the badge zone: one cell. The description (gap 10 > tolerance)
    // still splits.
    const header = line([item('DATE', 10, 40), item('DESCRIPTION', 62, 150)]);
    const rows: Line[] = [];
    for (let i = 0; i < 3; i++) {
      rows.push(line([item(`01/0${i + 1}/2025`, 10, 40), item('EMI', 40, 52), item(`M${i}`, 62, 130)]));
    }
    const r = detectColumnStacks(header, rows);
    expect(r.stacks.find(s => s.headerText === null)).toBeUndefined();
    const date = r.stacks.find(s => s.headerText === 'DATE')!;
    expect(date.right).toBe(52); // badge merged in — documented degradation
    expect(r.stacks).toHaveLength(2);
  });

  it('returns no stacks for fewer than two date rows', () => {
    const { header, rows } = makeRows(1);
    const r = detectColumnStacks(header, rows);
    expect(r.stacks).toEqual([]);
  });

  it('two date columns: both typed date, headerless stacks need MIN_HEADERLESS_ROWS', () => {
    const header = line([item('CHARGE DATE', 10, 60), item('TRANSACTION DATE', 80, 140)]);
    const rows: Line[] = [];
    for (let i = 0; i < 10; i++) {
      rows.push(line([item(`01/0${(i % 8) + 1}/2025`, 10, 55), item(`02/0${(i % 8) + 1}/2025`, 80, 135)]));
    }
    const r = detectColumnStacks(header, rows);
    expect(r.stacks.map(s => s.concept)).toEqual(['date', 'date']);
    expect(MIN_HEADERLESS_ROWS).toBe(2);
  });

  it('Bank3 geometry: 3px-apart columns separate via the counting step, no collision flag', () => {
    // Measured on the real bank statement whose first three columns sit 3px
    // apart (40→43 and 140→143) with tolerance 7 — the columns group
    // together in step 1, but the zero-coverage strips between them split
    // the group back into three stacks in step 2. No collision, no repair.
    const header = line([item('DATE', 10, 40), item('DESCRIPTION', 43, 140), item('AMOUNT', 143, 200)]);
    const rows: Line[] = [];
    for (let i = 0; i < 10; i++) {
      rows.push(line([item(`01/0${(i % 8) + 1}/2025`, 10, 38), item(`MERCHANT ${i}`, 45, 135), item(`${100 + i}.00`, 145, 200)]));
    }
    const r = detectColumnStacks(header, rows);
    expect(r.twoHeaderCollision).toBe(false);
    expect(r.stacks.map(s => s.headerText)).toEqual(['DATE', 'DESCRIPTION', 'AMOUNT']);
    expect(r.stacks[0].right).toBeLessThanOrEqual(42);
    expect(r.stacks[1].left).toBeGreaterThanOrEqual(41);
    expect(r.stacks[1].right).toBeLessThanOrEqual(142);
    expect(r.stacks[2].left).toBeGreaterThanOrEqual(141);
  });

  it('flags (does not repair) a genuinely bridged gap between two named columns', () => {
    // Description items physically reach into the amount column's space on
    // every row, so the strip between the columns is covered everywhere and
    // the counting step cannot split them: two headers share one stack. The
    // loud-failure flag turns on; nothing is silently patched.
    const header = line([item('DATE', 10, 40), item('DESCRIPTION', 43, 140), item('AMOUNT', 143, 200)]);
    const rows: Line[] = [];
    for (let i = 0; i < 10; i++) {
      rows.push(line([item(`01/0${(i % 8) + 1}/2025`, 10, 38), item(`LONG DESCRIPTION ${i}`, 45, 150), item(`${100 + i}.00`, 145, 200)]));
    }
    const r = detectColumnStacks(header, rows);
    expect(r.twoHeaderCollision).toBe(true);
    // The date column still separates; description and amount land in one
    // flagged stack.
    expect(r.stacks.map(s => s.headerText)).toEqual(['DATE', 'DESCRIPTION']);
  });

  it('the currency symbol forms its own headerless column next to the amount (merge reverted)', () => {
    // The miscoded-INR case measured on the real statement. A seam-margin
    // variant that merged the symbol into the amount cell was implemented
    // and reverted on 2026-08-27: with the symbol inside the cells the
    // model mis-typed five debit rows as credit. The split-column format is
    // the behavior verified on real imports.
    const header = line([item('DATE', 10, 40), item('DESCRIPTION', 60, 150), item('AMOUNT', 170, 200)]);
    const rows: Line[] = [];
    for (let i = 0; i < 10; i++) {
      rows.push(line([item(`01/0${(i % 8) + 1}/2025`, 10, 40), item(`MERCHANT ${i}`, 60, 130), item('C', 166, 169), item(`${100 + i}.00`, 170, 200)]));
    }
    const r = detectColumnStacks(header, rows);
    expect(r.stacks.map(s => s.headerText)).toEqual(['DATE', 'DESCRIPTION', null, 'AMOUNT']);
    expect(r.stacks[3].left).toBe(170); // the amount stack starts at the digits
  });

  it('a minority sign fragment also forms its own column (merge reverted)', () => {
    // '+' appears on only some rows, left of the symbol — same reverted
    // behavior: its own column, which the model discards.
    const header = line([item('DATE', 10, 40), item('DESCRIPTION', 60, 150), item('AMOUNT', 170, 200)]);
    const rows: Line[] = [];
    for (let i = 0; i < 10; i++) {
      const items = [item(`01/0${(i % 8) + 1}/2025`, 10, 40), item(`MERCHANT ${i}`, 60, 130), item('C', 166, 169), item(`${100 + i}.00`, 170, 200)];
      if (i % 3 === 0) items.push(item('+', 162, 164));
      rows.push(line(items));
    }
    const r = detectColumnStacks(header, rows);
    expect(r.stacks.filter(s => s.headerText === null).length).toBe(2); // sign and symbol columns
    expect(r.stacks.find(s => s.headerText === 'AMOUNT')!.left).toBe(170);
  });

  it('a wide header does not absorb a separate symbol stack', () => {
    const header = line([item('DATE', 10, 40), item('AMOUNT', 160, 200)]);
    const rows: Line[] = [];
    for (let i = 0; i < 10; i++) {
      rows.push(line([item(`01/0${(i % 8) + 1}/2025`, 10, 40), item('C', 164, 167), item(`${100 + i}.00`, 170, 200)]));
    }
    const r = detectColumnStacks(header, rows);
    expect(r.stacks.filter(s => s.headerText === null)).toHaveLength(1);
    expect(r.stacks.find(s => s.headerText === null)).toMatchObject({ left: 164, right: 167 });
    expect(r.stacks.find(s => s.headerText === 'AMOUNT')).toMatchObject({ left: 160, right: 200 });
  });

  it('a header whose data lives on non-date lines still forms its column (wrapped table)', () => {
    // The wrapped-geometry fixture: description text sits on lines above and
    // below the date line, so the date-bearing rows carry no description
    // items at all. The DESCRIPTION header must still produce a column for
    // the description items to assign into.
    const header = line([item('DATE', 40, 120), item('DESCRIPTION', 180, 310), item('REWARDS', 400, 440), item('AMOUNT (INR)', 480, 550)]);
    const rows: Line[] = [];
    for (let i = 0; i < 10; i++) {
      rows.push(line([item(`04/0${(i % 8) + 1}/2025 00:00`, 40, 118), item(`+${i}`, 400, 412), item(`${100 + i}.35`, 486, 540)]));
    }
    const r = detectColumnStacks(header, rows);
    expect(r.stacks.map(s => s.headerText)).toEqual(['DATE', 'DESCRIPTION', 'REWARDS', 'AMOUNT (INR)']);
    expect(r.stacks[1].left).toBe(180);
    expect(r.stacks[1].right).toBe(310);
  });
});
