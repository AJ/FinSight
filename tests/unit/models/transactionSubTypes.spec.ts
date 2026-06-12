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

  it('preserves all consolidated subTypes', () => {
    const expected = [
      'purchase', 'fee', 'charge', 'refund', 'rewards',
      'interest', 'debt_payment', 'investment', 'withdrawal',
      'adjustment', 'transfer',
    ];
    for (const sub of expected) {
      expect(TRANSACTION_SUB_TYPES).toContain(sub);
    }
  });
});
