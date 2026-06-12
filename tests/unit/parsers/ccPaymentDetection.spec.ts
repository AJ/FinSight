import { describe, it, expect } from 'vitest';

import { normalizeCCTransactionSubTypes } from '@/lib/parsers/ccPaymentDetection';
import { makeTransaction } from '@tests/unit/factories';
import type { Transaction } from '@/types';
import type { TransactionSubType } from '@/models/Transaction';
import { SourceType } from '@/models';

function makeCCTransaction(overrides: {
  description: string;
  amount?: number;
  transactionSubType?: string;
  isCredit?: boolean;
}): Transaction {
  return makeTransaction({
    sourceType: SourceType.CreditCard,
    type: overrides.isCredit !== false ? 'credit' : 'debit',
    transactionSubType: (overrides.transactionSubType ?? 'debt_payment') as TransactionSubType,
    description: overrides.description,
    amount: overrides.amount ?? 5000,
  });
}

describe('normalizeCCTransactionSubTypes', () => {
  it('preserves debt_payment when NEFT with CC keyword', () => {
    const txn = makeCCTransaction({ description: 'NEFT-HDFCBANK-CC' });
    const result = normalizeCCTransactionSubTypes([txn]);
    expect(result[0].transactionSubType).toBe('debt_payment');
  });

  it('preserves debt_payment when autopay with issuer and cc', () => {
    const txn = makeCCTransaction({ description: 'AUTOPAY HDFC CC 4821' });
    const result = normalizeCCTransactionSubTypes([txn]);
    expect(result[0].transactionSubType).toBe('debt_payment');
  });

  it('preserves debt_payment when BillDesk with space separator', () => {
    const txn = makeCCTransaction({ description: 'BillDesk HDFC0000012345' });
    const result = normalizeCCTransactionSubTypes([txn]);
    expect(result[0].transactionSubType).toBe('debt_payment');
  });

  it('preserves debt_payment when issuer name with card keyword', () => {
    const txn = makeCCTransaction({ description: 'HDFC CARD PAYMENT' });
    const result = normalizeCCTransactionSubTypes([txn]);
    expect(result[0].transactionSubType).toBe('debt_payment');
  });

  it('preserves debt_payment when IMPS with card keyword', () => {
    const txn = makeCCTransaction({ description: 'IMPS-ICICI CC PAYMENT' });
    const result = normalizeCCTransactionSubTypes([txn]);
    expect(result[0].transactionSubType).toBe('debt_payment');
  });

  it('preserves debt_payment for cashback transactions', () => {
    const txn = makeCCTransaction({
      description: 'CASHBACK REWARD',
      transactionSubType: 'debt_payment',
    });
    const result = normalizeCCTransactionSubTypes([txn]);
    expect(result[0].transactionSubType).toBe('debt_payment');
  });

  it('reclassifies unmatched debt_payment as refund', () => {
    const txn = makeCCTransaction({
      description: 'AMAZON.IN REFUND',
      transactionSubType: 'debt_payment',
    });
    const result = normalizeCCTransactionSubTypes([txn]);
    expect(result[0].transactionSubType).toBe('refund');
  });

  it('does not reclassify debit transactions', () => {
    const txn = makeCCTransaction({
      description: 'SOME PURCHASE',
      isCredit: false,
      transactionSubType: 'purchase',
    });
    const result = normalizeCCTransactionSubTypes([txn]);
    expect(result[0].transactionSubType).toBe('purchase');
  });

  it('does not reclassify bank transactions', () => {
    const txn = makeTransaction({
      sourceType: SourceType.Bank,
      type: 'credit',
      transactionSubType: 'debt_payment' as TransactionSubType,
      description: 'SOME PAYMENT',
    });
    const result = normalizeCCTransactionSubTypes([txn]);
    expect(result[0].transactionSubType).toBe('debt_payment');
  });

  it('handles UPI payment with issuer and cc', () => {
    const txn = makeCCTransaction({ description: 'UPI-HDFC-CC-4821' });
    const result = normalizeCCTransactionSubTypes([txn]);
    expect(result[0].transactionSubType).toBe('debt_payment');
  });

  it('does not false-positive on "accessory" containing "cc"', () => {
    const txn = makeCCTransaction({
      description: 'AMAZON ACCESSORY STORE',
      transactionSubType: 'debt_payment',
    });
    const result = normalizeCCTransactionSubTypes([txn]);
    // "cc" in "accessory" should NOT trigger payment detection
    expect(result[0].transactionSubType).toBe('refund');
  });

  it('does not false-positive on "success" containing "cc"', () => {
    const txn = makeCCTransaction({
      description: 'PAYMENT SUCCESS TRANSACTION',
      transactionSubType: 'debt_payment',
    });
    const result = normalizeCCTransactionSubTypes([txn]);
    expect(result[0].transactionSubType).toBe('refund');
  });

  it('preserves debt_payment for RTGS with issuer', () => {
    const txn = makeCCTransaction({ description: 'RTGS-AXIS-CC-PAYMENT' });
    const result = normalizeCCTransactionSubTypes([txn]);
    expect(result[0].transactionSubType).toBe('debt_payment');
  });

  it('does not reclassify CC credit with non-debt_payment subType', () => {
    const txn = makeCCTransaction({
      description: 'AMAZON.IN REFUND',
      transactionSubType: 'refund',
    });
    const result = normalizeCCTransactionSubTypes([txn]);
    expect(result[0].transactionSubType).toBe('refund');
  });

  it('does not reclassify CC credit with purchase subType', () => {
    const txn = makeCCTransaction({
      description: 'Some merchant',
      transactionSubType: 'purchase',
    });
    const result = normalizeCCTransactionSubTypes([txn]);
    expect(result[0].transactionSubType).toBe('purchase');
  });
});
