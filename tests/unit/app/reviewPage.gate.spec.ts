import { describe, it, expect } from 'vitest';
import { hasHardReason, type ReviewReason } from '@/lib/review/reviewReasons';

// The review-page commit gate is `pendingTransactions.some((t) => hasHardReason(t.reviewReasons))`.
// This pins the predicate over the reason lists the page actually sees, independent of the
// Transaction class — no factory or `as any` needed.
describe('review page commit gate (hard-subset check on the list)', () => {
  it('blocks when any transaction carries a hard reason', () => {
    const lists: ReviewReason[][] = [
      ['low_confidence'],
      ['low_confidence', 'self_transfer_unresolved'], // self_transfer_unresolved is hard
    ];
    expect(lists.some(hasHardReason)).toBe(true);
  });

  it('does NOT block when only advisory reasons are present', () => {
    const lists: ReviewReason[][] = [
      ['low_confidence'],
      ['low_confidence', 'fingerprint_collision'], // both advisory (fingerprint_collision → A2)
      [],
    ];
    expect(lists.some(hasHardReason)).toBe(false);
  });

  it('does NOT block when every list is empty (all clean)', () => {
    expect([[], []].some(hasHardReason)).toBe(false);
  });
});
