import { type Transaction, DEBIT_SUB_TYPES, CREDIT_SUB_TYPES } from '@/models/Transaction';
import type { VerificationReport } from '@/lib/verification/verificationEngine';
import { addReason, type ReviewReason } from './reviewReasons';

// Verification-confidence FLAG threshold (spec §6.2). Distinct from
// verificationEngine.MIN_CONFIDENCE_ACCEPT (=75), which is the verified/rejected
// SPLIT. 85 is the soft flag threshold for low_confidence. Do not conflate.
const VERIFICATION_FLAG_THRESHOLD = 85;
// Category-confidence FLAG threshold (spec §6.2). The categorizer's own confidence
// in its category assignment; below this the row is flagged low_confidence.
const CATEGORY_CONFIDENCE_FLAG_THRESHOLD = 0.85;

export function hasMissingOrInvalidField(t: Transaction): boolean {
  // subtype is guaranteed present on LLM-extracted rows (fromExtracted/fromJSON),
  // but CSV/XLS imports build Transaction positionally and bypass that guarantee,
  // so an absent subtype is reachable and must be caught here (spec §6.1).
  if (!t.transactionSubType) return true;
  if (!t.category) return true;
  if (typeof t.amount !== 'number' || !isFinite(t.amount)) return true;
  if (!(t.date instanceof Date) || isNaN(t.date.getTime())) return true;
  return false;
}

// A subtype valid only for the opposite direction (e.g. a debit "refund") is a
// data error (spec §3.1 / §4 table). DEBIT/CREDIT_SUB_TYPES enumerate which
// subtypes each direction permits; a subtype absent from its direction's list is
// flagged hard so it is corrected before commit. Absent subtypes are caught
// earlier by hasMissingOrInvalidField, so this only runs when one is set.
export function hasDirectionMismatch(t: Transaction): boolean {
  const sub = t.transactionSubType;
  if (!sub) return false;
  const valid = t.isDebit ? DEBIT_SUB_TYPES : CREDIT_SUB_TYPES;
  return !valid.includes(sub);
}

/**
 * Assign review reasons to transactions (spec §6). Runs on every import,
 * including CSV/XLS, which produce no verification report — `report` is optional.
 *
 * Collect-all (spec §6.4): every reason that applies is added; hard and advisory
 * reasons coexist on the same row. This stamper runs AFTER the categorizer and
 * UNIONS its reasons onto whatever the categorizer already set (it does not
 * overwrite). Display priority (spec §6.3) is a presentation concern, handled by
 * sortedForDisplay — not by selection here.
 *
 * Hard (spec §6.1) — produced here:
 *  - missing/invalid required field  -> missing_or_invalid_field   [transaction]
 *  - subtype-direction conflict      -> subtype_direction_mismatch [transaction]
 *  - subtype inferred from direction -> subtype_inferred           [transaction; llmConfidence 0]
 * Advisory (spec §6.2) — owned here:
 *  - verified confidence < 85 OR category confidence < 0.85 -> low_confidence [report|transaction]
 *  - duplicate                       -> fingerprint_collision (provisional)  [report]
 *
 * Reconciliation failure is NOT stamped per-transaction: it is a statement-level
 * fact, so stamping every row made the per-row indicator meaningless. It is surfaced
 * once, via the VerificationSummary banner on the review page (report.reconciliation).
 *
 * low_confidence is a single reason (spec §6.2: the extraction-vs-category
 * distinction is not tracked); it fires when EITHER confidence is low.
 *
 * With no report (CSV/XLS), the report-based lookups no-op and only the
 * transaction-derived reasons can fire — which is exactly what CSV/XLS needs,
 * since every such row has an inferred subtype (subtype_inferred, hard) plus a
 * keyword-fallback category confidence (0.3 → low_confidence, advisory).
 *
 * subtype_inferred is hard (A1): an inferred subtype means the row's role/routing
 * is a guess, so it cannot be trusted through to commit. fingerprint_collision is
 * advisory/provisional (A2): no duplicate-decision control ships yet, so a hard
 * reason would block commit with no resolution path.
 */
export function applyVerificationReviewReasons(
  transactions: Transaction[],
  report?: VerificationReport,
): Transaction[] {
  const duplicateIds = new Set((report?.duplicates ?? []).map((t) => t.id));
  // Rejected rows (engine confidence < MIN_CONFIDENCE_ACCEPT) are absent from
  // report.verified, so the confidence lookup below would miss them and they'd render
  // clean — despite being the STRONGEST "could not be matched to the statement" signal
  // and despite the VerificationSummary counting them as flagged. Treat rejection as a
  // low-confidence trigger so the row surfaces it.
  const rejectedIds = new Set(
    (report?.rejected ?? []).map((t) => (t && typeof t.id === 'string' ? t.id : null)).filter((id): id is string => id !== null),
  );
  const confidenceById = new Map<string, number>();
  // The report is a contract seam: today it comes from a deterministic engine, but
  // schema drift (LLM-derived reports, storage round-trips) could yield verified
  // entries missing id or carrying a non-number confidence. Validate each entry's
  // shape before keying the map — otherwise it keys on undefined ids and compares
  // string confidences (`'70' < 85` coerces to true), silently mis-flagging rows.
  for (const v of report?.verified ?? []) {
    if (v && typeof v.id === 'string' && typeof v.confidence === 'number') {
      confidenceById.set(v.id, v.confidence);
    }
  }

  return transactions.map((t) => {
    // Union onto the categorizer's reasons (spec §6.4). Collect-all: append-only,
    // so a length change is the precise signal that a new reason was added.
    let reasons: ReviewReason[] = [...t.reviewReasons];

    if (hasMissingOrInvalidField(t)) {
      reasons = addReason(reasons, 'missing_or_invalid_field');
    }
    if (hasDirectionMismatch(t)) {
      reasons = addReason(reasons, 'subtype_direction_mismatch');
    }
    if (t.llmConfidence === 0) {
      // Producer signal (spec §3.4): the subtype is a direction default, not an
      // extracted fact. Convert the durable llmConfidence-0 marker into subtype_inferred.
      reasons = addReason(reasons, 'subtype_inferred');
    }

    // Advisories — owned by this stamper (spec §6.3). low_confidence fires on
    // EITHER signal; it is a single deduped reason. A rejected row (engine confidence
    // < MIN_CONFIDENCE_ACCEPT) is absent from confidenceById, so it is added explicitly
    // — rejection is the low end of the same confidence scale and must surface on the row.
    const conf = confidenceById.get(t.id);
    const lowVerification = rejectedIds.has(t.id)
      || (conf !== undefined && conf < VERIFICATION_FLAG_THRESHOLD);
    const lowCategory =
      typeof t.categoryConfidence === 'number' &&
      t.categoryConfidence < CATEGORY_CONFIDENCE_FLAG_THRESHOLD;
    if (lowVerification || lowCategory) {
      reasons = addReason(reasons, 'low_confidence');
    }
    if (duplicateIds.has(t.id)) {
      reasons = addReason(reasons, 'fingerprint_collision');   // advisory (A2)
    }

    if (reasons.length === t.reviewReasons.length) return t;   // nothing added
    return t.cloneWith({ reviewReasons: reasons });
  });
}
