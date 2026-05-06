import { describe, it, expect } from 'vitest';

import { normalizeCCTransactionSubTypes } from '@/lib/parsers/ccPaymentDetection';
import { makeTransaction } from '@tests/unit/factories';
import type { Transaction } from '@/types';
import type { TransactionSubType } from '@/models/Transaction';

function makeCCTransaction(overrides: {
  description: string;
  amount?: number;
  originalText?: string;
  transactionSubType?: string;
  isCredit?: boolean;
}): Transaction {
  return makeTransaction({
    sourceType: 'credit_card' as const,
    type: overrides.isCredit !== false ? 'credit' : 'debit',
    isCredit: overrides.isCredit !== false,
    transactionSubType: (overrides.transactionSubType ?? 'bill_payment') as TransactionSubType,
    description: overrides.description,
    amount: overrides.amount ?? 5000,
    originalText: overrides.originalText,
  });
}

describe('normalizeCCTransactionSubTypes', () => {
  it('preserves bill_payment when NEFT with CC keyword', () => {
    const txn = makeCCTransaction({ description: 'NEFT-HDFCBANK-CC' });
    const result = normalizeCCTransactionSubTypes([txn]);
    expect(result[0].transactionSubType).toBe('bill_payment');
  });

  it('preserves bill_payment when autopay with issuer and cc', () => {
    const txn = makeCCTransaction({ description: 'AUTOPAY HDFC CC 4821' });
    const result = normalizeCCTransactionSubTypes([txn]);
    expect(result[0].transactionSubType).toBe('bill_payment');
  });

  it('preserves bill_payment when BillDesk with space separator', () => {
    const txn = makeCCTransaction({ description: 'BillDesk HDFC0000012345' });
    const result = normalizeCCTransactionSubTypes([txn]);
    expect(result[0].transactionSubType).toBe('bill_payment');
  });

  it('preserves bill_payment when issuer name with card keyword', () => {
    const txn = makeCCTransaction({ description: 'HDFC CARD PAYMENT' });
    const result = normalizeCCTransactionSubTypes([txn]);
    expect(result[0].transactionSubType).toBe('bill_payment');
  });

  it('preserves bill_payment when IMPS with card keyword', () => {
    const txn = makeCCTransaction({ description: 'IMPS-ICICI CC PAYMENT' });
    const result = normalizeCCTransactionSubTypes([txn]);
    expect(result[0].transactionSubType).toBe('bill_payment');
  });

  it('preserves bill_payment for cashback transactions', () => {
    const txn = makeCCTransaction({
      description: 'CASHBACK REWARD',
      transactionSubType: 'bill_payment',
    });
    const result = normalizeCCTransactionSubTypes([txn]);
    expect(result[0].transactionSubType).toBe('bill_payment');
  });

  it('reclassifies unmatched bill_payment as refund', () => {
    const txn = makeCCTransaction({
      description: 'AMAZON.IN REFUND',
      transactionSubType: 'bill_payment',
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
      sourceType: 'bank' as const,
      type: 'credit',
      isCredit: true,
      transactionSubType: 'bill_payment' as TransactionSubType,
      description: 'SOME PAYMENT',
    });
    const result = normalizeCCTransactionSubTypes([txn]);
    expect(result[0].transactionSubType).toBe('bill_payment');
  });

  it('handles UPI payment with issuer and cc', () => {
    const txn = makeCCTransaction({ description: 'UPI-HDFC-CC-4821' });
    const result = normalizeCCTransactionSubTypes([txn]);
    expect(result[0].transactionSubType).toBe('bill_payment');
  });

  it('does not false-positive on "accessory" containing "cc"', () => {
    const txn = makeCCTransaction({
      description: 'AMAZON ACCESSORY STORE',
      transactionSubType: 'bill_payment',
    });
    const result = normalizeCCTransactionSubTypes([txn]);
    // "cc" in "accessory" should NOT trigger payment detection
    expect(result[0].transactionSubType).toBe('refund');
  });

  it('does not false-positive on "success" containing "cc"', () => {
    const txn = makeCCTransaction({
      description: 'PAYMENT SUCCESS TRANSACTION',
      transactionSubType: 'bill_payment',
    });
    const result = normalizeCCTransactionSubTypes([txn]);
    expect(result[0].transactionSubType).toBe('refund');
  });

  it('preserves bill_payment for RTGS with issuer', () => {
    const txn = makeCCTransaction({ description: 'RTGS-AXIS-CC-PAYMENT' });
    const result = normalizeCCTransactionSubTypes([txn]);
    expect(result[0].transactionSubType).toBe('bill_payment');
  });
});
