import type { Line } from './extractionTypes';
import { matchConcept } from './headerSynonyms';

/**
 * Column-stack detection (spec 2026-08-26, Part 1). Pure geometry: items in,
 * column stacks out. No pixel constants — the merge tolerance is the
 * statement's own glyph scale (median font height), and the minority carve
 * is a row-count ratio.
 */

export interface StackItem {
  x: number;
  right: number;
  /** Detection-row index: 0 = header row, 1..N = date-bearing rows. */
  row: number;
  /** Font height — the glyph scale the tolerance derives from. */
  height: number;
  /** Header items carry their text for naming; data items carry none. */
  text: string | null;
}

export interface DetectedStack {
  left: number;
  right: number;
  headerText: string | null;
  concept: string | null;
  /** Distinct detection rows with at least one item in this stack. */
  coverageRows: number;
}

export interface StackDetectionResult {
  stacks: DetectedStack[];
  detectionRows: number;
  tolerance: number;
  /** A run held two or more header items — the tolerance failed a gutter. */
  twoHeaderCollision: boolean;
}

/** A headerless stack needs items on at least this many distinct rows. */
export const MIN_HEADERLESS_ROWS = 2;

/**
 * The merge tolerance is the glyph scale: the median body font height.
 * Tokens sharing a cell are kerned closer than one glyph; column gutters are
 * at least one glyph wide. This is runtime-derived per statement (no pixel
 * constant) and fails safely: a gutter narrower than a glyph (the
 * AMOUNT↔PI-style case) merges, which the header-pair cut then repairs if
 * the Part 0 gate shows it. Floored at 1 so degenerate zero-height PDFs
 * cannot collapse it.
 */
export function deriveMergeTolerance(heights: number[]): number {
  if (heights.length === 0) return 1;
  const sorted = [...heights].sort((a, b) => a - b);
  return Math.max(1, Math.round(sorted[Math.floor(sorted.length / 2)]));
}

/**
 * Merge spans (sorted left-to-right) into groups: a span joins the current
 * group when it overlaps it or sits within the tolerance of its rightmost
 * edge. Generic so callers pass any item shape carrying x/right.
 */
export function groupOverlapping<T extends { x: number; right: number }>(
  items: T[],
  tolerance: number,
): T[][] {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const groups: T[][] = [];
  let current: T[] = [];
  let maxRight = -Infinity;
  for (const it of sorted) {
    if (current.length > 0 && it.x > maxRight + tolerance) {
      groups.push(current);
      current = [];
    }
    current.push(it);
    maxRight = Math.max(maxRight, it.right);
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

function stackFrom(items: StackItem[], fallbackLeft: number, fallbackRight: number): DetectedStack {
  const headerItem = items.find(it => it.row === 0 && it.text !== null) ?? null;
  return {
    left: items.length ? Math.min(...items.map(i => i.x)) : fallbackLeft,
    right: items.length ? Math.max(...items.map(i => i.right)) : fallbackRight,
    headerText: headerItem?.text ?? null,
    concept: headerItem !== null ? matchConcept(headerItem.text!) : null,
    coverageRows: new Set(items.map(i => i.row)).size,
  };
}

/**
 * Detect the column stacks of one region (spec Part 1). Input rows are the
 * header line and the date-bearing lines only; name lines and banners carry
 * no date and so never bend detection. Rule 1 groups overlapping spans with
 * the derived tolerance; Rule 2 carves minority headerless stretches out of
 * groups that also have majority content. A group with no majority stretch
 * at all is a sparse column and stays whole.
 */
export function detectColumnStacks(
  headerLine: Line | null,
  anchorRows: Line[],
): StackDetectionResult {
  const detectionRows = (headerLine ? 1 : 0) + anchorRows.length;
  if (!headerLine || anchorRows.length < 2) {
    return { stacks: [], detectionRows, tolerance: 0, twoHeaderCollision: false };
  }

  const items: StackItem[] = [];
  headerLine.items.forEach(it => items.push({ x: it.x, right: it.right, row: 0, height: it.height, text: it.text }));
  anchorRows.forEach((l, i) => l.items.forEach(it => items.push({ x: it.x, right: it.right, row: i + 1, height: it.height, text: null })));

  const tolerance = deriveMergeTolerance(anchorRows.flatMap(l => l.items.map(it => it.height)));

  const groups = groupOverlapping(items, tolerance);
  const stacks: DetectedStack[] = [];
  let twoHeaderCollision = false;
  const dataRows = anchorRows.length;

  for (const group of groups) {
    // Segment the group's x-range by DATA coverage only: boundary points are
    // the group's own item edges; each elementary segment counts how many
    // DATA rows cover it (headers are excluded — a header legitimately spans
    // wider than its data). Segments join into runs separated only by
    // breaks: a gap wider than the tolerance (real blank space), or a thin
    // gap flanked by two different headers (two named columns meet there).
    // A change between majority and minority coverage is NOT a break — a
    // fragment a few pixels from majority content is part of that cell, so
    // signs and currency symbols stay with their amounts.
    const points = [...new Set(group.flatMap(it => [it.x, it.right]))].sort((a, b) => a - b);
    if (points.length < 2) {
      stacks.push(stackFrom(group, points[0] ?? 0, points[0] ?? 0));
      continue;
    }
    const runs: { majority: boolean; from: number; to: number; items: StackItem[] }[] = [];
    for (let i = 0; i + 1 < points.length; i++) {
      const from = points[i];
      const to = points[i + 1];
      const covering = new Set(
        group.filter(it => it.row > 0 && it.x <= from && it.right >= to).map(it => it.row),
      );
      if (covering.size === 0) continue;
      const majority = covering.size * 2 >= dataRows;
      const last = runs[runs.length - 1];
      if (last && last.majority === majority && last.to === from) {
        last.to = to;
      } else {
        runs.push({ majority, from, to, items: [] });
      }
    }
    // Data items join the run containing their center.
    for (const it of group) {
      if (it.row === 0) continue;
      const center = (it.x + it.right) / 2;
      const run = runs.find(r => center >= r.from && center <= r.to);
      if (run) run.items.push(it);
    }
    // Header items join the run they overlap the most (a header legitimately
    // spans the full cell width, wider than its data).
    for (const it of group) {
      if (it.row !== 0) continue;
      let best: (typeof runs)[number] | undefined;
      let bestOverlap = 0;
      let bestDist = Infinity;
      for (const run of runs) {
        const overlap = Math.min(it.right, run.to) - Math.max(it.x, run.from);
        const dist = overlap > 0 ? 0 : (it.x >= run.to ? it.x - run.to : run.from - it.right);
        if (overlap > bestOverlap || (overlap === bestOverlap && dist < bestDist)) {
          bestOverlap = overlap;
          bestDist = dist;
          best = run;
        }
      }
      if (best) best.items.push(it);
    }

    const hasMajority = runs.some(r => r.majority);
    if (!hasMajority) {
      // Sparse column (named or headerless): stays whole — including the
      // wrapped-table case, where a column's data lives entirely on
      // non-date lines and only its header reaches detection.
      if (group.filter(it => it.row === 0).length >= 2) twoHeaderCollision = true;
      stacks.push(stackFrom(group, points[0], points[points.length - 1]));
      continue;
    }

    for (const run of runs) {
      if (run.items.length === 0) continue;
      const runHeaders = run.items.filter(it => it.row === 0);
      if (run.majority) {
        if (runHeaders.length >= 2) {
          // A run holding two or more headers means data items physically
          // bridge the space between two named columns. Not patched: the
          // flag drives the loud detection-failure log (spec Part 1).
          twoHeaderCollision = true;
        }
        stacks.push(stackFrom(run.items, run.from, run.to));
      } else if (runHeaders.length > 0) {
        // A sparse named stretch keeps its own column (headers are exempt
        // from the carve).
        stacks.push(stackFrom(run.items, run.from, run.to));
      } else if (new Set(run.items.map(it => it.row)).size >= MIN_HEADERLESS_ROWS) {
        stacks.push(stackFrom(run.items, run.from, run.to));
      }
      // Else: headerless minority under the row minimum — its items match
      // no stack and land in the overflow slot at assignment.
    }
  }

  return {
    stacks,
    detectionRows,
    tolerance,
    twoHeaderCollision,
  };
}
