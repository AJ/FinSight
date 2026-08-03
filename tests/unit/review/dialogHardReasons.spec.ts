import { describe, it, expect } from 'vitest';
import { computeDialogHardReasons, MIN_DATE, maxAllowedDate, type DialogFormState } from '@/components/review/reviewEditDialogCompanion';
import '@/lib/categorization/categories';

// A clean, fully-valid debit purchase. Every test spreads this and mutates one field
// so the assertions isolate the exact condition under test.
const clean = (): DialogFormState => ({
  type: 'debit',
  amount: 100,
  date: new Date('2026-01-15'),
  transactionSubType: 'purchase',
  categoryId: 'groceries',
  llmConfidence: 0.9,
  isForcedSelection: false,
  hasInferred: false,
  hasSelfTransferUnresolved: false,
});

describe('computeDialogHardReasons (validate-before-save, spec §6.3)', () => {
  it('a clean, consistent row has no hard reasons', () => {
    expect(computeDialogHardReasons(clean())).toEqual([]);
  });

  // --- Data-deficiency reasons (re-derived from fields; clear when fixed) ---
  it('flags missing_or_invalid_field when amount is NaN', () => {
    expect(computeDialogHardReasons({ ...clean(), amount: NaN })).toEqual(['missing_or_invalid_field']);
  });

  it('flags missing_or_invalid_field when date is null', () => {
    expect(computeDialogHardReasons({ ...clean(), date: null })).toEqual(['missing_or_invalid_field']);
  });

  // --- Date range: must fall within [2000-01-01, today] inclusive ---
  it('accepts the MIN_DATE boundary (2000-01-01)', () => {
    expect(computeDialogHardReasons({ ...clean(), date: new Date(MIN_DATE) })).toEqual([]);
  });

  it('rejects a date before 2000-01-01 (e.g. 1999-12-31)', () => {
    const out = computeDialogHardReasons({ ...clean(), date: new Date('1999-12-31T00:00:00') });
    expect(out).toContain('missing_or_invalid_field');
  });

  it('rejects a future date (today + 1 day)', () => {
    const tomorrow = new Date(maxAllowedDate());
    tomorrow.setDate(tomorrow.getDate() + 1);
    const out = computeDialogHardReasons({ ...clean(), date: tomorrow });
    expect(out).toContain('missing_or_invalid_field');
  });

  it('accepts today (floored to start of day)', () => {
    expect(computeDialogHardReasons({ ...clean(), date: maxAllowedDate() })).toEqual([]);
  });

  it('accepts a transaction dated today with a non-zero time component', () => {
    const now = new Date(); // current wall-clock, may have non-zero time
    expect(computeDialogHardReasons({ ...clean(), date: now })).toEqual([]);
  });

  it('flags subtype_direction_mismatch when the subtype is invalid for the direction', () => {
    // refund is credit-only; a debit refund is a direction conflict.
    expect(computeDialogHardReasons({ ...clean(), transactionSubType: 'refund' })).toEqual([
      'subtype_direction_mismatch',
    ]);
  });

  it('flags invalid_subtype_category for a real subtype paired with an invalid category', () => {
    // purchase + income is not a valid combo (spec §5 map).
    expect(computeDialogHardReasons({ ...clean(), categoryId: 'income' })).toEqual([
      'invalid_subtype_category',
    ]);
  });

  it('does NOT flag invalid_subtype_category for an inferred subtype (llmConfidence 0)', () => {
    // An inferred subtype paired with a category is the inference's fault, not a combo
    // error — and the dialog's cascade only offers valid categories anyway.
    const out = computeDialogHardReasons({ ...clean(), llmConfidence: 0, categoryId: 'fees' });
    expect(out).not.toContain('invalid_subtype_category');
  });

  // --- Classification-decision reasons (cleared by forced selection) ---
  it('keeps subtype_inferred until the user picks BOTH subtype and category', () => {
    const inferredBlank = { ...clean(), isForcedSelection: true, hasInferred: true, transactionSubType: undefined, categoryId: '' };
    expect(computeDialogHardReasons(inferredBlank)).toEqual(['subtype_inferred']);

    // Subtype picked but category still blank → still blocked.
    const subtypeOnly = { ...inferredBlank, transactionSubType: 'purchase' as const };
    expect(computeDialogHardReasons(subtypeOnly)).toEqual(['subtype_inferred']);

    // Both picked → subtype_inferred clears.
    const both = { ...subtypeOnly, categoryId: 'groceries' };
    expect(computeDialogHardReasons(both)).toEqual([]);
  });

  it('keeps self_transfer_unresolved until both are picked', () => {
    const blank = { ...clean(), isForcedSelection: true, hasSelfTransferUnresolved: true, transactionSubType: undefined, categoryId: '' };
    expect(computeDialogHardReasons(blank)).toEqual(['self_transfer_unresolved']);
    const both = { ...blank, transactionSubType: 'self_transfer' as const, categoryId: 'transfer' };
    expect(computeDialogHardReasons(both)).toEqual([]);
  });

  // --- A normal row whose field the user cleared ---
  it('flags missing_or_invalid_field when a non-forced row has its category cleared', () => {
    expect(computeDialogHardReasons({ ...clean(), categoryId: '' })).toEqual(['missing_or_invalid_field']);
  });

  // --- Collect-all: multiple hard reasons coexist ---
  it('a forced row that also has a bad amount carries both reasons', () => {
    const out = computeDialogHardReasons({
      ...clean(),
      amount: NaN,
      isForcedSelection: true,
      hasInferred: true,
      transactionSubType: undefined,
      categoryId: '',
    });
    expect(out).toEqual(expect.arrayContaining(['missing_or_invalid_field', 'subtype_inferred']));
  });

  it('never returns advisory reasons (they ride through save, §6.4)', () => {
    // No advisory reason is in scope of this function; verify the function cannot emit
    // any of them regardless of inputs by exhausting the data-deficiency + forced paths.
    const advisory = ['low_confidence', 'fingerprint_collision'] as const;
    const samples: DialogFormState[] = [
      { ...clean(), amount: NaN },
      { ...clean(), date: null },
      { ...clean(), transactionSubType: 'refund' },
      { ...clean(), categoryId: 'income' },
      { ...clean(), isForcedSelection: true, hasInferred: true, transactionSubType: undefined, categoryId: '' },
    ];
    for (const s of samples) {
      for (const a of advisory) {
        expect(computeDialogHardReasons(s)).not.toContain(a);
      }
    }
  });
});
