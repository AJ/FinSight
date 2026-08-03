import { describe, it, expect } from 'vitest';
import { applyCategorizationResults } from '@/lib/categorization/aiCategorizer';
import { makeTransaction } from '@tests/unit/factories';
import { TransactionType } from '@/models/TransactionType';
import type { TransactionSubType } from '@/models/Transaction';
import '@/lib/categorization/categories';

function makeTxn(subType: TransactionSubType, type: TransactionType) {
  return makeTransaction({
    id: 't1',
    type: type === TransactionType.Credit ? 'credit' : 'debit',
    transactionSubType: subType,
  });
}

// The categorizer produces ONLY invalid_subtype_category and self_transfer_unresolved
// (spec §6.3 reasons 4–5). low_confidence is NOT its job — that moved to the
// verification stamper, which reads both verification and category confidence.
describe('applyCategorizationResults — reviewReasons (collect-all, spec §6.3/§6.4)', () => {
  it('flags invalid_subtype_category when category not valid under subtype', () => {
    // D1: classification is the subtype authority, so the result carries the subtype it is
    // asserting. 'purchase' + 'income' is an unreachable (subtype, category) combo.
    const out = applyCategorizationResults(
      [makeTxn('purchase', TransactionType.Debit)],
      [{ id: 't1', transactionSubType: 'purchase', category: 'income', confidence: 0.95, source: 'ai' as const }],
    );
    expect(out[0].reviewReasons).toContain('invalid_subtype_category');
  });

  it('flags self_transfer_unresolved when the resolved subtype is self_transfer (deterministic)', () => {
    // Thread #3: the stamp keys on the classifier's subtype decision, not a probabilistic
    // isSuspense flag. Every self_transfer is ownership-unresolved by definition.
    const out = applyCategorizationResults(
      [makeTxn('purchase', TransactionType.Debit)],
      [{ id: 't1', category: 'transfer', confidence: 0.5, source: 'ai' as const, transactionSubType: 'self_transfer' }],
    );
    expect(out[0].reviewReasons).toContain('self_transfer_unresolved');
    expect(out[0].transactionSubType).toBe('self_transfer');
  });

  it('does NOT stamp self_transfer_unresolved for a non-self_transfer subtype', () => {
    const out = applyCategorizationResults(
      [makeTxn('purchase', TransactionType.Debit)],
      [{ id: 't1', category: 'groceries', confidence: 0.9, source: 'ai' as const, transactionSubType: 'purchase' }],
    );
    expect(out[0].reviewReasons).not.toContain('self_transfer_unresolved');
  });

  it('collect-all: a self_transfer row with an invalid combo carries BOTH reasons', () => {
    // A row that is both an unresolved transfer and an invalid subtype/category combo.
    const out = applyCategorizationResults(
      [makeTxn('self_transfer', TransactionType.Debit)],
      [{ id: 't1', category: 'groceries', confidence: 0.5, source: 'ai' as const, transactionSubType: 'self_transfer' }],
    );
    expect(out[0].reviewReasons).toEqual(
      expect.arrayContaining(['self_transfer_unresolved', 'invalid_subtype_category']),
    );
  });

  it('does NOT stamp low_confidence — that is the verification stamper’s job (spec §6.3)', () => {
    // Even with category confidence 0.6 (< 0.85), the categorizer leaves low_confidence
    // to the verification stamper. A clean combo produces no categorizer-side reason.
    const out = applyCategorizationResults(
      [makeTxn('purchase', TransactionType.Debit)],
      [{ id: 't1', category: 'groceries', confidence: 0.6, source: 'ai' as const }],
    );
    expect(out[0].reviewReasons).toEqual([]);
  });

  it('leaves reviewReasons empty when confident and consistent', () => {
    const out = applyCategorizationResults(
      [makeTxn('purchase', TransactionType.Debit)],
      [{ id: 't1', category: 'groceries', confidence: 0.95, source: 'ai' as const }],
    );
    expect(out[0].reviewReasons).toEqual([]);
  });

  it('leaves a transaction unchanged when it has no result', () => {
    const txn = makeTxn('purchase', TransactionType.Debit);
    const out = applyCategorizationResults([txn], []);
    expect(out[0]).toBe(txn);
  });

  it('does NOT flag invalid_subtype_category when the subtype is inferred (llmConfidence 0)', () => {
    // CSV/XLS path: no real subtype, so it was inferred from direction (debit →
    // purchase, llmConfidence 0). A conflicting category (fees under purchase) is
    // the dummy's fault, not a data error — so the combo check is skipped.
    const txn = makeTransaction({ id: 't1', type: 'debit' }); // no subType → inferred
    expect(txn.llmConfidence).toBe(0); // guardrail: this is the inferred signal

    const out = applyCategorizationResults(
      [txn],
      [{ id: 't1', category: 'fees', confidence: 0.95, source: 'ai' as const }],
    );
    expect(out[0].reviewReasons).toEqual([]);
  });

  it('an inferred subtype with low category confidence produces no categorizer-side reason', () => {
    // low_confidence is the verification stamper's concern, not the categorizer's, so
    // even a low-confidence inferred row gets nothing here (combo skipped + no
    // low_confidence). The verification stamper adds subtype_inferred + low_confidence.
    const txn = makeTransaction({ id: 't1', type: 'debit' }); // inferred purchase
    const out = applyCategorizationResults(
      [txn],
      [{ id: 't1', category: 'fees', confidence: 0.5, source: 'ai' as const }],
    );
    expect(out[0].reviewReasons).toEqual([]);
  });
});
