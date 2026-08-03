import { describe, it, expect } from 'vitest';
import { makeTransaction, makeCategory } from '@tests/unit/factories';

// Routing is pure-subtype: category never determines the bucket. These tests pin
// the cloneWith invariant — changing a transaction's category preserves its
// subtype (the subtype is the authoritative classifier, not the category).
describe('cloneWith preserves transactionSubType across category edits', () => {
  it('preserves self_transfer subType when resolving to cc_bill_payment', () => {
    const txn = makeTransaction({
      amount: 30000,
      transactionSubType: 'self_transfer',
      category: makeCategory('shopping', true),
    });

    const resolved = txn.cloneWith({ category: 'cc_bill_payment' });

    expect(resolved.category.id).toBe('cc_bill_payment');
    expect(resolved.transactionSubType).toBe('self_transfer');
  });

  it('preserves self_transfer subType when resolving to investment', () => {
    const txn = makeTransaction({
      amount: 10000,
      transactionSubType: 'self_transfer',
      category: makeCategory('shopping', true),
    });

    const resolved = txn.cloneWith({ category: 'investment' });

    expect(resolved.category.id).toBe('investment');
    expect(resolved.transactionSubType).toBe('self_transfer');
  });

  it('preserves self_transfer subType when resolving to loans', () => {
    const txn = makeTransaction({
      amount: 20000,
      transactionSubType: 'self_transfer',
      category: makeCategory('transfer', false),
    });

    const resolved = txn.cloneWith({ category: 'loans' });

    expect(resolved.category.id).toBe('loans');
    expect(resolved.transactionSubType).toBe('self_transfer');
  });

  it('preserves purchase subType when resolving to a non-override expense', () => {
    const txn = makeTransaction({
      amount: 500,
      transactionSubType: 'purchase',
      category: makeCategory('shopping', true),
    });

    const resolved = txn.cloneWith({ category: 'dining' });

    expect(resolved.category.id).toBe('dining');
    expect(resolved.transactionSubType).toBe('purchase');
  });
});
