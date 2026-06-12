import type { RawTextItem, Line } from './extractionTypes';
import { Y_GROUP_TOLERANCE } from './extractionTypes';

/**
 * Stage 2: Group raw text items into lines by y-position.
 * Items within Y_GROUP_TOLERANCE pixels of each other on the same page
 * are grouped into the same line. Lines are sorted by y descending
 * (top of page first). Items within each line are sorted by x ascending.
 */
export function groupIntoLines(items: RawTextItem[]): Line[] {
  const lines: Line[] = [];

  for (const item of items) {
    const existing = lines.find(
      line => line.page === item.page && Math.abs(line.y - item.y) < Y_GROUP_TOLERANCE,
    );
    if (existing) {
      existing.items.push(item);
    } else {
      lines.push({ y: item.y, items: [item], page: item.page });
    }
  }

  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
  }

  // Sort by page first, then y descending within each page.
  // This prevents interleaving lines from different pages that share
  // y-coordinates, which would cause table regions to span across pages.
  lines.sort((a, b) => a.page - b.page || b.y - a.y);

  return lines;
}
