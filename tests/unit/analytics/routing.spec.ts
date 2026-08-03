import { describe, it, expect } from 'vitest';
import { routeTransaction, bucketTransactions } from '@/lib/analytics/routing';
import { makeTransaction, makeCategory } from '@tests/unit/factories';
import { SourceType } from '@/types';

describe('routeTransaction', () => {
  // --- Bank routing ---

  describe('Bank routing', () => {
    it('purchase/bank_charge/charge debit -> outflow', () => {
      for (const sub of ['purchase', 'bank_charge', 'charge'] as const) {
        expect(routeTransaction(makeTransaction({ amount: 100, type: 'debit', transactionSubType: sub }))).toBe('outflow');
      }
    });

    it('interest debit -> outflow (interest charged)', () => {
      expect(routeTransaction(makeTransaction({ amount: 100, type: 'debit', transactionSubType: 'interest' }))).toBe('outflow');
    });

    it('adjustment debit -> outflow; credit -> inflow (direction-driven)', () => {
      expect(routeTransaction(makeTransaction({ amount: 100, type: 'debit', transactionSubType: 'adjustment' }))).toBe('outflow');
      expect(routeTransaction(makeTransaction({ amount: 100, type: 'credit', transactionSubType: 'adjustment' }))).toBe('inflow');
    });

    it('withdrawal debit -> excluded', () => {
      expect(routeTransaction(makeTransaction({ amount: 100, type: 'debit', transactionSubType: 'withdrawal' }))).toBe('excluded');
    });

    it('self_transfer -> excluded', () => {
      expect(routeTransaction(makeTransaction({ amount: 100, type: 'debit', transactionSubType: 'self_transfer' }))).toBe('excluded');
    });

    it('debt_payment debit -> debtPayments', () => {
      expect(routeTransaction(makeTransaction({ amount: 100, type: 'debit', transactionSubType: 'debt_payment' }))).toBe('debtPayments');
    });

    it('bank credit debt_payment -> inflow (loan disbursement)', () => {
      expect(routeTransaction(makeTransaction({ amount: 100, type: 'credit', transactionSubType: 'debt_payment' }))).toBe('inflow');
    });

    it('investment -> investments', () => {
      expect(routeTransaction(makeTransaction({ amount: 100, type: 'debit', transactionSubType: 'investment' }))).toBe('investments');
    });

    it('income/interest/rewards credit -> inflow', () => {
      for (const sub of ['income', 'interest', 'rewards'] as const) {
        expect(routeTransaction(makeTransaction({ amount: 100, type: 'credit', transactionSubType: sub }))).toBe('inflow');
      }
    });

    it('refund credit -> outflowOffset', () => {
      expect(routeTransaction(makeTransaction({ amount: 100, type: 'credit', transactionSubType: 'refund' }))).toBe('outflowOffset');
    });
  });

  // --- CC routing (liability account) ---

  describe('CC routing', () => {
    it('CC purchase debit -> outflow (a charge grows the liability)', () => {
      expect(routeTransaction(makeTransaction({ amount: 100, type: 'debit', transactionSubType: 'purchase', sourceType: SourceType.CreditCard }))).toBe('outflow');
    });

    it('CC withdrawal debit -> outflow (cash advance is new debt)', () => {
      expect(routeTransaction(makeTransaction({ amount: 100, type: 'debit', transactionSubType: 'withdrawal', sourceType: SourceType.CreditCard }))).toBe('outflow');
    });

    it('CC debt_payment credit -> ccInvisible (the bill payment)', () => {
      expect(routeTransaction(makeTransaction({ amount: 100, type: 'credit', transactionSubType: 'debt_payment', sourceType: SourceType.CreditCard }))).toBe('ccInvisible');
    });

    it('CC rewards/income credit -> outflowOffset (credits offset the bill)', () => {
      expect(routeTransaction(makeTransaction({ amount: 100, type: 'credit', transactionSubType: 'rewards', sourceType: SourceType.CreditCard }))).toBe('outflowOffset');
      expect(routeTransaction(makeTransaction({ amount: 100, type: 'credit', transactionSubType: 'income', sourceType: SourceType.CreditCard }))).toBe('outflowOffset');
    });

    it('CC refund credit -> outflowOffset', () => {
      expect(routeTransaction(makeTransaction({ amount: 100, type: 'credit', transactionSubType: 'refund', sourceType: SourceType.CreditCard }))).toBe('outflowOffset');
    });
  });

  // --- Authority ---

  describe('category is never read (spec §3.2)', () => {
    it('purchase debit routes outflow regardless of category', () => {
      const a = makeTransaction({ amount: 100, type: 'debit', transactionSubType: 'purchase', category: makeCategory('groceries', true) });
      const b = makeTransaction({ amount: 100, type: 'debit', transactionSubType: 'purchase', category: makeCategory('income', false) });
      expect(routeTransaction(a)).toBe('outflow');
      expect(routeTransaction(b)).toBe('outflow');
    });
  });

  describe('throws on contract violations (no silent fallthrough)', () => {
    it('throws when the subtype is absent', () => {
      // The producer guarantee (spec §3.4) makes a subtype always present; routing
      // must fail loud rather than silently mis-bucket if that contract is broken.
      const t = makeTransaction({ amount: 100, type: 'debit', transactionSubType: 'purchase' });
      Object.defineProperty(t, 'transactionSubType', { value: undefined, writable: true });
      expect(() => routeTransaction(t)).toThrow(/without a subtype/);
    });

    it('throws when the subtype is not in the routing table', () => {
      // A non-canonical value can only arrive via a cast or un-validated JSON; the
      // closed routing tables reject it instead of defaulting to a bucket silently.
      const t = makeTransaction({ amount: 100, type: 'debit', transactionSubType: 'purchase' });
      Object.defineProperty(t, 'transactionSubType', { value: 'not_a_real_subtype', writable: true });
      expect(() => routeTransaction(t)).toThrow(/Unknown transaction subtype/);
    });
  });
});

describe('bucketTransactions', () => {
  it('separates a mixed set of transactions into correct buckets', () => {
    const txns = [
      makeTransaction({ amount: 100000, type: 'credit', transactionSubType: 'interest', category: makeCategory('salary', false) }),
      makeTransaction({ amount: 5000, type: 'debit', transactionSubType: 'purchase', category: makeCategory('shopping', true) }),
      makeTransaction({ amount: 10000, type: 'debit', transactionSubType: 'investment', category: makeCategory('investment', true) }),
      makeTransaction({ amount: 30000, type: 'debit', transactionSubType: 'debt_payment', category: makeCategory('cc_bill_payment', false) }),
      makeTransaction({ amount: 500, type: 'credit', transactionSubType: 'refund', category: makeCategory('shopping', true) }),
      makeTransaction({ amount: 2000, type: 'debit', transactionSubType: 'self_transfer', category: makeCategory('transfer', false) }),
    ];

    const result = bucketTransactions(txns);

    expect(result.inflow).toHaveLength(1);
    expect(result.outflow).toHaveLength(1);
    expect(result.outflowOffset).toHaveLength(1);
    expect(result.investments).toHaveLength(1);
    expect(result.debtPayments).toHaveLength(1);
    expect(result.excluded).toHaveLength(1);
    expect(result.ccInvisible).toHaveLength(0);
  });

  it('returns empty arrays for empty input', () => {
    const result = bucketTransactions([]);
    expect(result.inflow).toHaveLength(0);
    expect(result.outflow).toHaveLength(0);
    expect(result.outflowOffset).toHaveLength(0);
    expect(result.investments).toHaveLength(0);
    expect(result.debtPayments).toHaveLength(0);
    expect(result.excluded).toHaveLength(0);
    expect(result.ccInvisible).toHaveLength(0);
  });

  it('every transaction lands in exactly one bucket (no double-counting)', () => {
    const txns = [
      makeTransaction({ amount: 100, type: 'credit', transactionSubType: 'interest', category: makeCategory('salary', false) }),
      makeTransaction({ amount: 50, type: 'debit', transactionSubType: 'purchase', category: makeCategory('dining', true) }),
      makeTransaction({ amount: 10000, type: 'debit', transactionSubType: 'investment', category: makeCategory('investment', true) }),
      makeTransaction({ amount: 5000, type: 'debit', transactionSubType: 'debt_payment', category: makeCategory('loans', false) }),
      makeTransaction({ amount: 200, type: 'credit', transactionSubType: 'refund', category: makeCategory('shopping', true) }),
      makeTransaction({ amount: 300, type: 'debit', transactionSubType: 'self_transfer', category: makeCategory('transfer', false) }),
      makeTransaction({ amount: 25000, type: 'credit', transactionSubType: 'debt_payment', category: makeCategory('cc_bill_payment', false), sourceType: SourceType.CreditCard }),
    ];
    const result = bucketTransactions(txns);
    const total = Object.values(result).reduce((sum, arr) => sum + arr.length, 0);
    expect(total).toBe(txns.length);
  });
});
