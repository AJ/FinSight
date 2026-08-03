import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReviewEditDialog } from '@/components/review/ReviewEditDialog';
import { makeTransaction } from '@tests/unit/factories';
import type { ReviewReason } from '@/lib/review/reviewReasons';
import '@/lib/categorization/categories';

// makeTransaction builds via fromExtracted: a subtype given with no `confidence`
// yields llmConfidence undefined; a subtype omitted yields defaultSubtype +
// llmConfidence 0. reviewReasons is layered on with cloneWith so each case controls
// exactly which reasons the dialog sees.
function makeTxn(opts: { subType?: string; type?: 'debit' | 'credit'; reviewReasons?: ReviewReason[] }) {
  const t = makeTransaction({
    id: 't1',
    type: opts.type ?? 'debit',
    transactionSubType: opts.subType,
  });
  return t.cloneWith({ reviewReasons: opts.reviewReasons ?? [] });
}

function renderDialog(txn: ReturnType<typeof makeTxn>, onSave: (id: string, u: Record<string, unknown>) => void = () => {}) {
  return render(
    <ReviewEditDialog
      transaction={txn}
      open={true}
      onOpenChange={() => {}}
      onSave={onSave}
    />,
  );
}

describe('ReviewEditDialog (M:N cascade + validate-before-save)', () => {
  it('offers only categories valid under the subtype (M:N, spec §3.2)', () => {
    renderDialog(makeTxn({ subType: 'purchase', type: 'debit' }));
    const categorySelect = document.querySelector('#edit-category') as HTMLSelectElement;
    const ids = Array.from(categorySelect.options).map((o) => o.value).filter(Boolean);
    expect(ids).toContain('groceries');   // valid under purchase
    expect(ids).not.toContain('income');  // not valid under purchase
  });

  it('blanks subtype+category and shows the blocking reason for a classification-decision row (spec §6.3)', () => {
    renderDialog(makeTxn({ subType: 'purchase', reviewReasons: ['subtype_inferred'] }));
    // Validate-before-save surfaces the blocking reason(s) while they remain.
    expect(screen.getByText(/resolve before saving/i)).toBeTruthy();
    expect(screen.getByText(/subtype not confirmed/i)).toBeTruthy();
    const subtypeSelect = document.querySelector('#edit-subtype') as HTMLSelectElement;
    // Display blanked (forced selection); the underlying txn still carries 'purchase' for routing/roleOf.
    expect(subtypeSelect.value).toBe('');
  });

  it('Save is disabled while a hard reason remains (validate-before-save, spec §6.3)', () => {
    renderDialog(makeTxn({ subType: 'purchase', reviewReasons: ['subtype_inferred'] }));
    // jest-dom is not configured (tests/unit/setup.ts) — use hasAttribute, not toBeDisabled.
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);
  });

  it('Save stays disabled when a field is changed then reverted (net-diff dirty gate)', () => {
    // Dirty means the saved result would differ from the stored row — not "a field
    // was touched." Reverting a field to its original value is not a change, so Save
    // must stay disabled and the user cannot no-op save-and-close.
    renderDialog(makeTxn({ subType: 'purchase' }));
    const desc = document.querySelector('#edit-desc') as HTMLInputElement;
    const original = desc.value;
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(desc, { target: { value: 'temporary edit' } });
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(false);
    fireEvent.change(desc, { target: { value: original } });
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);
  });

  it('saving a resolved forced row clears low_confidence (row-own) and the hard reason', () => {
    const onSave = vi.fn();
    // subtype_inferred (hard) + low_confidence (advisory, row-own). Resolving the forced
    // selection drops the hard reason; the full-row review also clears low_confidence (§6.3).
    renderDialog(
      makeTxn({ subType: 'purchase', reviewReasons: ['subtype_inferred', 'low_confidence'] }),
      onSave,
    );
    fireEvent.change(document.querySelector('#edit-subtype')!, { target: { value: 'investment' } });
    fireEvent.change(document.querySelector('#edit-category')!, { target: { value: 'investment' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith('t1', expect.objectContaining({
      transactionSubType: 'investment',
      reviewReasons: [],                  // hard reason + low_confidence both cleared
      llmConfidence: undefined,           // inferred marker cleared on user confirmation
      categoryConfidence: undefined,      // stale categorizer confidence dropped on manual pick
    }));
  });

  it('persists non-row-fixable advisories (fingerprint_collision) through save', () => {
    const onSave = vi.fn();
    // fingerprint_collision is cross-row; editing this row cannot resolve it, so it persists.
    renderDialog(makeTxn({ subType: 'purchase', reviewReasons: ['fingerprint_collision'] }), onSave);
    // Trivial edit so the dirty gate allows save (no hard reason present).
    fireEvent.change(document.querySelector('#edit-desc')!, { target: { value: 'edited' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith('t1', expect.objectContaining({
      reviewReasons: ['fingerprint_collision'],
    }));
  });

  // --- Confidence readout (decision 8): 0-1 fields rendered as % ---
  it('shows verification + category confidence as rounded percentages', () => {
    // Regression guard for the 0-100 vs 0-1 scale bug: a real 0-1 value must render
    // as 88% / 60%, not 0.88% or 8800%. The reader (this component) and the writer
    // (statementVerificationService) must agree on the unit.
    const txn = makeTxn({ subType: 'purchase' }).cloneWith({
      verificationConfidence: 0.88,
      categoryConfidence: 0.6,
    });
    renderDialog(txn);
    expect(screen.getByText(/Verification 88%/)).toBeTruthy();
    expect(screen.getByText(/Category 60%/)).toBeTruthy();
  });

  // --- Task 4: type change re-scopes subtype + category ---
  it('changing type blanks subtype and category (re-scope under new direction)', () => {
    // A type change re-scopes subtype (direction-bound) and category (subtype-bound).
    // Both reset so a stale subtype cannot silently become direction-invalid.
    renderDialog(makeTxn({ subType: 'purchase', type: 'debit' }));
    fireEvent.change(document.querySelector('#edit-type')!, { target: { value: 'credit' } });
    expect((document.querySelector('#edit-subtype') as HTMLSelectElement).value).toBe('');
    expect((document.querySelector('#edit-category') as HTMLSelectElement).value).toBe('');
  });

  // --- Task 5: banner expando caps at two visible reasons ---
  it('expando reveals all reasons, then collapses back on "Show less"', () => {
    const txn = makeTxn({
      subType: 'purchase',
      reviewReasons: ['subtype_inferred', 'low_confidence', 'fingerprint_collision'],
    });
    renderDialog(txn);
    // Third reason hidden initially (banner caps at two, offers "+N more").
    expect(screen.queryByText(/keep both or remove one/i)).toBeNull();
    const moreBtn = Array.from(document.querySelectorAll('button')).find((b) =>
      /\+1 more/i.test(b.textContent || ''),
    )!;
    expect(moreBtn).toBeTruthy();
    fireEvent.click(moreBtn);
    // After expand: the duplicate hint surfaces, "+1 more" is gone, and a "Show less"
    // affordance appears (the toggle stays mounted while >2 reasons exist).
    expect(screen.getByText(/keep both or remove one/i)).toBeTruthy();
    expect(screen.queryByText(/\+1 more/i)).toBeNull();
    const lessBtn = Array.from(document.querySelectorAll('button')).find((b) =>
      /show less/i.test(b.textContent || ''),
    )!;
    expect(lessBtn).toBeTruthy();
    // Collapsing hides the third reason again and brings back "+1 more".
    fireEvent.click(lessBtn);
    expect(screen.queryByText(/keep both or remove one/i)).toBeNull();
    expect(
      Array.from(document.querySelectorAll('button')).some((b) => /\+1 more/i.test(b.textContent || '')),
    ).toBe(true);
  });

  it('does not render the toggle when there are two or fewer reasons', () => {
    // The toggle is gated on allReasons.length > 2: with exactly two (or one) reasons
    // there is nothing to expand, so neither "+N more" nor "Show less" should appear.
    renderDialog(makeTxn({ subType: 'purchase', reviewReasons: ['low_confidence', 'fingerprint_collision'] }));
    const toggle = Array.from(document.querySelectorAll('button')).find((b) =>
      /more|show less/i.test(b.textContent || ''),
    );
    expect(toggle).toBeUndefined();
  });

  // --- Task 4: date-window validity drives the field border ---
  it('an out-of-range date marks the field invalid (date-window border)', () => {
    renderDialog(makeTxn({ subType: 'purchase' }));
    const dateInput = document.querySelector('#edit-date') as HTMLInputElement;
    // 2520 parses to a valid Date but falls outside [2000-01-01, today].
    fireEvent.change(dateInput, { target: { value: '2520-01-01' } });
    expect(dateInput.getAttribute('aria-invalid')).toBe('true');
  });

  it('a valid in-range date keeps the field marked valid', () => {
    renderDialog(makeTxn({ subType: 'purchase' }));
    const dateInput = document.querySelector('#edit-date') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2024-06-15' } });
    // The attr is always emitted (we pass aria-invalid explicitly); valid → "false".
    expect(dateInput.getAttribute('aria-invalid')).toBe('false');
  });

  // --- parseFormDate null branch: clearing the date must not commit a null ---
  it('clearing the date is a no-op (null parse commits nothing, no false dirty state)', () => {
    renderDialog(makeTxn({ subType: 'purchase' }));
    const dateInput = document.querySelector('#edit-date') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '' } });
    // parseFormDate('') → null → set never called → form.date stays the original,
    // so the dirty gate is unaffected and Save remains disabled.
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);
  });
});
