import { describe, it, expect } from 'vitest';
import {
  REVIEW_REASONS, HARD_REASONS, isBlocking,
  hasReason, hasHardReason, addReason, removeReason,
  sortedForDisplay, DISPLAY_ORDER, topReason,
  type ReviewReason,
} from '@/lib/review/reviewReasons';

describe('review-reason severity table (spec §6)', () => {
  it('has exactly the 7 spec reasons', () => {
    expect(Object.keys(REVIEW_REASONS).sort()).toEqual([
      'fingerprint_collision',
      'invalid_subtype_category',
      'low_confidence',
      'missing_or_invalid_field',
      'self_transfer_unresolved',
      'subtype_direction_mismatch',
      'subtype_inferred',
    ]);
  });

  // Amended 2026-07-10 (spec §6.1/§6.2): subtype_inferred moved advisory→hard (A1);
  // fingerprint_collision moved hard→advisory, provisional (A2). The hard set is the
  // 5 user-actionable reasons; advisories are the 3 that flag but do not block.
  it('hard set is the 5 user-actionable reasons (amended 2026-07-10)', () => {
    expect(HARD_REASONS).toEqual(new Set([
      'missing_or_invalid_field',
      'self_transfer_unresolved',
      'invalid_subtype_category',
      'subtype_direction_mismatch',
      'subtype_inferred',
    ]));
  });

  it('isBlocking reflects the amended split', () => {
    expect(isBlocking('subtype_inferred')).toBe(true);        // was advisory (A1)
    expect(isBlocking('fingerprint_collision')).toBe(false);  // was hard (A2)
    expect(isBlocking('low_confidence')).toBe(false);
    expect(isBlocking(null)).toBe(false);
  });

  it('every reason carries severity + label + hint + a short action', () => {
    for (const def of Object.values(REVIEW_REASONS)) {
      expect(['hard', 'advisory']).toContain(def.severity);
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.hint.length).toBeGreaterThan(0);
      // Action is the row-marker pill text — short, so it renders consistently.
      expect(def.action.length).toBeGreaterThan(0);
      expect(def.action.length).toBeLessThanOrEqual(20);
    }
  });

  it('topReason returns the highest-priority reason, or null when clean', () => {
    expect(topReason([])).toBe(null);
    // A hard reason outranks an advisory regardless of input order.
    expect(topReason(['low_confidence', 'subtype_inferred'])).toBe('subtype_inferred');
    // Among advisories, DISPLAY_ORDER decides (low_confidence < fingerprint_collision).
    expect(topReason(['fingerprint_collision', 'low_confidence']))
      .toBe('low_confidence');
  });

  it('type-checks: a known reason is assignable to ReviewReason', () => {
    const r: ReviewReason = 'low_confidence';
    expect(r).toBe('low_confidence');
  });
});

// List model (spec §6.4): a row carries ALL its reasons at once. The helpers
// treat the array as a set; order is display-only.
describe('review-reason list helpers (spec §6.4)', () => {
  it('hasReason is membership', () => {
    const list: ReviewReason[] = ['subtype_inferred', 'low_confidence'];
    expect(hasReason(list, 'subtype_inferred')).toBe(true);
    expect(hasReason(list, 'fingerprint_collision')).toBe(false);
  });

  it('hasHardReason is true for a row carrying both a hard and an advisory', () => {
    // The case the single-field model could not express (spec §6.4):
    // a row can be subtype_inferred (hard) AND low_confidence (advisory) at once.
    expect(hasHardReason(['subtype_inferred', 'low_confidence'])).toBe(true);
    expect(hasHardReason(['low_confidence', 'fingerprint_collision'])).toBe(false);
    expect(hasHardReason([])).toBe(false);
  });

  it('addReason dedupes and does not mutate the input', () => {
    const list: ReviewReason[] = ['subtype_inferred'];
    const next = addReason(list, 'subtype_inferred');
    expect(next).toBe(list); // same reference — nothing to add

    const grown = addReason(list, 'low_confidence');
    expect(grown).toEqual(['subtype_inferred', 'low_confidence']);
    expect(list).toEqual(['subtype_inferred']); // input untouched
    expect(grown).not.toBe(list);
  });

  it('removeReason is a no-op when absent, and does not mutate', () => {
    const list: ReviewReason[] = ['subtype_inferred', 'low_confidence'];
    expect(removeReason(list, 'fingerprint_collision')).toBe(list); // absent → same ref

    const shrunk = removeReason(list, 'subtype_inferred');
    expect(shrunk).toEqual(['low_confidence']);
    expect(list).toEqual(['subtype_inferred', 'low_confidence']); // input untouched
  });

  it('sortedForDisplay follows the §6.3 order regardless of input order', () => {
    // Input deliberately out of order, mixing hard and advisory.
    const out = sortedForDisplay([
      'low_confidence',
      'self_transfer_unresolved',
      'missing_or_invalid_field',
      'subtype_inferred',
    ]);
    expect(out).toEqual([
      'missing_or_invalid_field',
      'subtype_inferred',
      'self_transfer_unresolved',
      'low_confidence',
    ]);
  });

  it('DISPLAY_ORDER lists all 7 reasons with hard before advisory', () => {
    expect(DISPLAY_ORDER).toHaveLength(7);
    const firstAdvisory = DISPLAY_ORDER.findIndex((r) => !HARD_REASONS.has(r));
    // Every hard reason precedes the first advisory in the spec's order.
    for (let i = 0; i < firstAdvisory; i++) {
      expect(HARD_REASONS.has(DISPLAY_ORDER[i])).toBe(true);
    }
    expect([...DISPLAY_ORDER].sort()).toEqual(Object.keys(REVIEW_REASONS).sort());
  });
});
