import { describe, it, expect } from 'vitest';
import { TRANSACTION_SUB_TYPES } from '@/models/Transaction';

describe('TRANSACTION_SUB_TYPES', () => {
  it('includes investment subType', () => {
    expect(TRANSACTION_SUB_TYPES).toContain('investment');
  });

  it('includes debt_payment subType (consolidated from debt + bill_payment)', () => {
    expect(TRANSACTION_SUB_TYPES).toContain('debt_payment');
  });

  it('includes refund subType (consolidated from refund + reversal + reimbursement)', () => {
    expect(TRANSACTION_SUB_TYPES).toContain('refund');
  });

  it('preserves all canonical subTypes (spec §4, 12 values)', () => {
    const expected = [
      'purchase', 'bank_charge', 'charge', 'refund', 'income',
      'interest', 'rewards', 'withdrawal', 'debt_payment',
      'investment', 'self_transfer', 'adjustment',
    ];
    expect(TRANSACTION_SUB_TYPES).toHaveLength(12);
    for (const sub of expected) {
      expect(TRANSACTION_SUB_TYPES).toContain(sub);
    }
  });
});
