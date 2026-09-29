// Spec §6. Single source of truth for review-reason severity. Severity is an
// attribute of the reason record (derived), not a persisted field. The commit
// gate, the producing engines, and the review UI all import from here.
// Not a configuration extension point.

export interface ReviewReasonDef {
  severity: 'hard' | 'advisory';
  label: string;
  hint: string;
  // Short verb-phrase shown on the row marker pill — what the user should DO. The
  // tooltip/dialog carry the full label + hint (what is wrong). Kept short and roughly
  // uniform in length so the pill renders consistently.
  action: string;
}

export const REVIEW_REASONS = {
  missing_or_invalid_field: {
    severity: 'hard',
    label: 'Missing or invalid field',
    hint: 'A required field (amount, date, type, subtype, or category) is missing or malformed',
    action: 'Fix field',
  },
  self_transfer_unresolved: {
    severity: 'hard',
    label: 'Unresolved transfer',
    hint: 'Confirm this is between your own accounts, or correct the role',
    action: 'Set category',
  },
  invalid_subtype_category: {
    severity: 'hard',
    label: 'Category not valid for subtype',
    hint: 'Pick a category listed under this subtype',
    action: 'Set category',
  },
  fingerprint_collision: {
    severity: 'advisory',          // was 'hard' (A2) — provisional: no duplicate-decision control yet
    label: 'Possible duplicate',
    hint: 'Possible duplicate — keep both or remove one (does not block commit)',
    action: 'Duplicate?',
  },
  subtype_direction_mismatch: {
    severity: 'hard',
    label: 'Subtype-direction conflict',
    hint: 'This subtype is not valid for the transaction direction (debit/credit)',
    action: 'Set subtype',
  },
  low_confidence: {
    severity: 'advisory',
    label: 'Low confidence',
    hint: 'Verify against the source',
    action: 'Verify',
  },
  subtype_inferred: {
    severity: 'hard',              // was 'advisory' (A1) — the subtype drives role/routing
    label: 'Subtype not confirmed',
    hint: 'The subtype is a default, not extracted — pick the subtype and category',
    action: 'Set subtype',
  },
  source_line_missing: {
    severity: 'advisory',
    label: 'Source line not reported',
    hint: 'The extraction did not report which statement line this row came from',
    action: 'Verify',
  },
} as const satisfies Record<string, ReviewReasonDef>;

export type ReviewReason = keyof typeof REVIEW_REASONS;

export const HARD_REASONS: ReadonlySet<ReviewReason> = new Set(
  (Object.entries(REVIEW_REASONS) as [ReviewReason, ReviewReasonDef][])
    .filter(([, d]) => d.severity === 'hard')
    .map(([k]) => k),
);

/** Whether a review reason blocks commit. Advisory reasons and null do not. */
export function isBlocking(reason: ReviewReason | null | undefined): boolean {
  return !!reason && HARD_REASONS.has(reason);
}

// --- List model (spec §6.4) ------------------------------------------------
// A transaction carries ALL its reasons at once (`reviewReasons: ReviewReason[]`),
// so a row can be, say, both subtype_inferred (hard) and low_confidence (advisory).
// These helpers treat the array as a set: deduped on add, order-independent on
// read. Order only matters for display, handled by DISPLAY_ORDER below.

/** Does the list contain this reason? */
export function hasReason(reasons: ReviewReason[], reason: ReviewReason): boolean {
  return reasons.includes(reason);
}

/** Does the list contain ANY hard reason? (Save is blocked while it does.) */
export function hasHardReason(reasons: ReviewReason[]): boolean {
  return reasons.some((r) => HARD_REASONS.has(r));
}

/** Does the row need attention? True when the row has any review reasons.
 * After commit, only some advisory reasons can remain — hard reasons are blocked
 * at the gate, and low_confidence is cleared when saving. */
export function needsAttention(reasons: ReviewReason[]): boolean {
  return reasons.length > 0;
}

/** Return a new list with `reason` added (no-op if already present). */
export function addReason(reasons: ReviewReason[], reason: ReviewReason): ReviewReason[] {
  return reasons.includes(reason) ? reasons : [...reasons, reason];
}

/** Return a new list with `reason` removed (no-op if absent). */
export function removeReason(reasons: ReviewReason[], reason: ReviewReason): ReviewReason[] {
  const i = reasons.indexOf(reason);
  return i === -1 ? reasons : [...reasons.slice(0, i), ...reasons.slice(i + 1)];
}

// Presentation order when several reasons coexist (spec §6.3). Display only —
// nothing is hidden, and stampers do not consult this (they collect all).
export const DISPLAY_ORDER: readonly ReviewReason[] = [
  'missing_or_invalid_field',
  'subtype_direction_mismatch',
  'subtype_inferred',
  'invalid_subtype_category',
  'self_transfer_unresolved',
  'low_confidence',
  'source_line_missing',
  'fingerprint_collision',
];

const DISPLAY_RANK: ReadonlyMap<ReviewReason, number> = new Map(
  DISPLAY_ORDER.map((r, i) => [r, i]),
);

/** Return the reasons sorted by DISPLAY_ORDER (unknown reasons sort last). */
export function sortedForDisplay(reasons: ReviewReason[]): ReviewReason[] {
  return [...reasons].sort((a, b) => (DISPLAY_RANK.get(a) ?? Infinity) - (DISPLAY_RANK.get(b) ?? Infinity));
}

/** The single reason to surface as the row marker (highest display priority), or null
 *  when the row is clean. The marker pill shows this reason's `action` text. */
export function topReason(reasons: ReviewReason[]): ReviewReason | null {
  const sorted = sortedForDisplay(reasons);
  return sorted.length > 0 ? sorted[0] : null;
}
