import { describe, it, expect } from 'vitest';
import { applyVerificationReviewReasons } from '@/lib/review/applyVerificationReviewReasons';
import { sortedForDisplay } from '@/lib/review/reviewReasons';
import { Transaction } from '@/models/Transaction';
import { TransactionType } from '@/models/TransactionType';
import { Category } from '@/models/Category';
import { SourceType } from '@/types';
import { makeTransaction } from '@tests/unit/factories';
import type { ReviewReason } from '@/lib/review/reviewReasons';
import type { VerificationReport, VerifiedTransaction } from '@/lib/verification/verificationEngine';
import '@/lib/categorization/categories';

// Mirrors how csvParser/xlsParser build transactions positionally WITHOUT a subtype —
// the real path to an undefined subtype, since they bypass fromExtracted's guarantee.
function makeTxnWithoutSubtype(id: string): Transaction {
  return new Transaction(
    id, new Date('2026-01-01'), 'd', 100, TransactionType.Debit, Category.fromId('other')!,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    SourceType.Bank, undefined, undefined, undefined, undefined,
    { code: 'INR', symbol: '₹', name: 'Indian Rupee' }, undefined, undefined, false,
  );
}

function makeVerified(id: string, confidence: number): VerifiedTransaction {
  return Object.assign(makeTransaction({ id, transactionSubType: 'purchase' }), {
    confidence,
    evidenceAnchor: undefined,
    verification: {
      amountMatched: true,
      dateMatched: true,
      descriptionMatched: true,
      contextMatched: true,
      typeMatched: true,
    },
  });
}

const baseReport = (over: Partial<VerificationReport> = {}): VerificationReport => ({
  verified: [], rejected: [], duplicates: [],
  reconciliation: { passed: true }, overallConfidence: 100, ...over,
});

// sortedForDisplay gives a stable order for multi-reason equality checks; the stamper
// itself is order-independent (collect-all), so we normalize before comparing.
const reasons = (t: Transaction): ReviewReason[] => sortedForDisplay(t.reviewReasons);

describe('applyVerificationReviewReasons (collect-all, spec §6.4)', () => {
  it('flags fingerprint_collision for duplicates', () => {
    const dup = makeTransaction({ id: 't1', transactionSubType: 'purchase' });
    const out = applyVerificationReviewReasons([dup], baseReport({ duplicates: [dup] }));
    expect(reasons(out[0])).toEqual(['fingerprint_collision']);
  });

  it('flags missing_or_invalid_field when subtype is absent (CSV/XLS path)', () => {
    const t = makeTxnWithoutSubtype('t1');
    const out = applyVerificationReviewReasons([t], baseReport());
    expect(reasons(out[0])).toEqual(['missing_or_invalid_field']);
  });

  it('flags missing_or_invalid_field when amount is NaN', () => {
    const t = makeTransaction({ id: 't1', transactionSubType: 'purchase', amount: NaN });
    const out = applyVerificationReviewReasons([t], baseReport());
    expect(reasons(out[0])).toEqual(['missing_or_invalid_field']);
  });

  it('flags subtype_direction_mismatch when the subtype is invalid for the direction', () => {
    // refund is credit-only; a debit refund is a direction conflict, flagged hard.
    const t = makeTransaction({ id: 't1', type: 'debit', transactionSubType: 'refund', confidence: 0.9 });
    const out = applyVerificationReviewReasons([t], baseReport());
    expect(reasons(out[0])).toEqual(['subtype_direction_mismatch']);
  });

  it('flags low_confidence when verified confidence < 85', () => {
    const t = makeTransaction({ id: 't1', transactionSubType: 'purchase' });
    const out = applyVerificationReviewReasons([t], baseReport({ verified: [makeVerified('t1', 70)] }));
    expect(reasons(out[0])).toEqual(['low_confidence']);
  });

  it('flags low_confidence for a transaction the engine REJECTED (not only verified-but-soft)', () => {
    // Rejection (< MIN_CONFIDENCE_ACCEPT 75) is a STRONGER signal than verified-but-soft
    // (< 85), yet it surfaced nowhere on the row: rejected rows are absent from
    // report.verified, so the confidence lookup returned undefined and low_confidence
    // never fired. A fully-rejected row must still flag — otherwise it renders clean
    // while the VerificationSummary counts it as "flagged".
    const t = makeTransaction({ id: 't1', transactionSubType: 'purchase' });
    const out = applyVerificationReviewReasons([t], baseReport({ rejected: [makeVerified('t1', 40)] }));
    expect(reasons(out[0])).toEqual(['low_confidence']);
  });

  it('flags low_confidence when CATEGORY confidence < 0.85 (relocated from categorizer, spec §6.3)', () => {
    // Verification confidence is high (95) but category confidence is low (0.4) — a
    // cleanly-verified row that was categorized with low confidence. low_confidence is
    // owned by this stamper and fires on EITHER signal.
    const t = makeTransaction({ id: 't1', transactionSubType: 'purchase', categoryConfidence: 0.4 });
    const out = applyVerificationReviewReasons([t], baseReport({ verified: [makeVerified('t1', 95)] }));
    expect(reasons(out[0])).toEqual(['low_confidence']);
  });

  it('does not flag low_confidence when category confidence is exactly the threshold', () => {
    // 0.85 is the boundary; the check is strict <, so 0.85 must NOT flag.
    const t = makeTransaction({ id: 't1', transactionSubType: 'purchase', categoryConfidence: 0.85 });
    const out = applyVerificationReviewReasons([t], baseReport({ verified: [makeVerified('t1', 95)] }));
    expect(reasons(out[0])).toEqual([]);
  });

  it('flags subtype_inferred when the subtype is a direction default (llmConfidence 0)', () => {
    const t = makeTransaction({ id: 't1' });
    expect(t.llmConfidence).toBe(0);
    const out = applyVerificationReviewReasons([t], baseReport());
    expect(reasons(out[0])).toEqual(['subtype_inferred']);
  });

  it('collect-all: an inferred duplicate carries BOTH subtype_inferred and fingerprint_collision', () => {
    // The case the single-field model could not express (spec §6.4): a row that is
    // both inferred (hard) and a duplicate (advisory) carries both reasons at once.
    const t = makeTransaction({ id: 't1' }); // inferred, llmConfidence 0
    const out = applyVerificationReviewReasons([t], baseReport({ duplicates: [t] }));
    expect(reasons(out[0])).toEqual(['subtype_inferred', 'fingerprint_collision']);
  });

  it('collect-all: an inferred low-confidence row carries BOTH subtype_inferred and low_confidence', () => {
    // Hard and advisory coexist — advisory low_confidence is NOT suppressed by the hard reason.
    const t = makeTransaction({ id: 't1' }); // inferred, llmConfidence 0
    const out = applyVerificationReviewReasons([t], baseReport({ verified: [makeVerified('t1', 70)] }));
    expect(reasons(out[0])).toEqual(['subtype_inferred', 'low_confidence']);
  });

  it('unions onto reasons already set by the categorizer (does not overwrite)', () => {
    // The categorizer (runs first) set self_transfer_unresolved. This stamper must
    // KEEP it and ADD the advisories, not replace the list.
    const t = makeTransaction({ id: 't1', transactionSubType: 'purchase' })
      .cloneWith({ reviewReasons: ['self_transfer_unresolved'] });
    const out = applyVerificationReviewReasons(
      [t],
      baseReport({
        verified: [makeVerified('t1', 10)],
        reconciliation: { passed: false, difference: 999 },
      }),
    );
    expect(reasons(out[0])).toEqual([
      'self_transfer_unresolved',
      'low_confidence',
    ]);
  });

  it('does not flag a confident, consistent transaction', () => {
    const t = makeTransaction({ id: 't1', transactionSubType: 'purchase' });
    const out = applyVerificationReviewReasons([t], baseReport({ verified: [makeVerified('t1', 95)] }));
    expect(reasons(out[0])).toEqual([]);
  });

  it('does NOT stamp math_reconciliation_failure per-transaction when reconciliation fails', () => {
    // Reconciliation failure is a statement-level fact. Stamping every row made the
    // per-row indicator meaningless, so it is no longer stamped here — it surfaces once
    // via the VerificationSummary banner (report.reconciliation) instead.
    const out = applyVerificationReviewReasons(
      [makeTransaction({ id: 't1', transactionSubType: 'purchase' }),
       makeTransaction({ id: 't2', transactionSubType: 'purchase' })],
      baseReport({
        verified: [makeVerified('t1', 95), makeVerified('t2', 95)],
        reconciliation: { passed: false, difference: 500 },
      }),
    );
    expect(reasons(out[0])).toEqual([]);
    expect(reasons(out[1])).toEqual([]);
  });

  it('returns the same instance when nothing changes', () => {
    const t = makeTransaction({ id: 't1', transactionSubType: 'purchase' });
    const out = applyVerificationReviewReasons([t], baseReport({ verified: [makeVerified('t1', 95)] }));
    expect(out[0]).toBe(t);
  });

  it('runs without a report (CSV/XLS path): inferred subtype + keyword-fallback low confidence', () => {
    // CSV/XLS imports produce no report. Every row has an inferred subtype
    // (subtype_inferred), and keyword fallback assigns category confidence 0.3, which
    // now drives low_confidence from this stamper. Both coexist.
    const t = makeTransaction({ id: 't1', categoryConfidence: 0.3 }); // inferred, llmConfidence 0
    const out = applyVerificationReviewReasons([t]);
    expect(reasons(out[0])).toEqual(['subtype_inferred', 'low_confidence']);
  });

  it('runs without a report and leaves a clean, real-subtype transaction unflagged', () => {
    const t = makeTransaction({ id: 't1', transactionSubType: 'purchase', confidence: 0.9 });
    const out = applyVerificationReviewReasons([t]);
    expect(reasons(out[0])).toEqual([]);
  });

  it('ignores malformed verified entries (schema-drift guard)', () => {
    // The report is a contract seam. Schema drift (LLM-derived reports, storage
    // round-trips) could yield verified entries that lack id or carry a non-number
    // confidence. The stamper validates each entry's shape before keying the map;
    // bad entries are dropped instead of keying on undefined ids or comparing string
    // confidences. The t2/string case is the load-bearing one: without the guard,
    // '70' < 85 coerces to true and t2 is wrongly flagged low_confidence.
    const malformed = [
      { id: undefined, confidence: 70 },   // missing id — drop
      { id: 't2', confidence: '70' },      // string confidence — drop (would coerce without guard)
      null,                                 // null entry — drop
      makeVerified('t1', 95),               // valid — drives the lookup
    ] as unknown as VerifiedTransaction[];
    const t1 = makeTransaction({ id: 't1', transactionSubType: 'purchase' });
    const t2 = makeTransaction({ id: 't2', transactionSubType: 'purchase' });
    const out = applyVerificationReviewReasons([t1, t2], baseReport({ verified: malformed }));
    expect(reasons(out[0])).toEqual([]);   // t1: valid 95 → not flagged
    expect(reasons(out[1])).toEqual([]);   // t2: string-'70' entry dropped → not flagged
  });
});
