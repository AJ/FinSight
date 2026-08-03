import { describe, it, expect } from 'vitest';
import { Transaction } from '@/models/Transaction';
import { TransactionType } from '@/models/TransactionType';
import { Category } from '@/models/Category';
import '@/lib/categorization/categories';

function makeTxn(): Transaction {
  return new Transaction('id', new Date('2026-01-01'), 'd', 100, TransactionType.Debit, Category.fromId('other')!);
}

describe('reviewReasons round-trip (list model, spec §6.4)', () => {
  it('defaults to [] (clean)', () => {
    expect(makeTxn().reviewReasons).toEqual([]);
  });

  it('cloneWith reviewReasons persists through toJSON/fromJSON', () => {
    const t = makeTxn().cloneWith({ reviewReasons: ['self_transfer_unresolved', 'low_confidence'] });
    expect(Transaction.fromJSON(t.toJSON()).reviewReasons).toEqual(['self_transfer_unresolved', 'low_confidence']);
  });

  it('cloneWith reviewReasons: [] clears the list', () => {
    const t = makeTxn().cloneWith({ reviewReasons: ['low_confidence'] });
    const cleared = t.cloneWith({ reviewReasons: [] });
    expect(cleared.reviewReasons).toEqual([]);
  });
});
