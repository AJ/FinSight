import { describe, it, expect } from 'vitest';
import { reconcileBalances, pickBoundaryBalances } from '@/lib/parsers/balanceReconcile';

describe('pickBoundaryBalances', () => {
  it('takes the first non-null opening and the last non-null closing across chunks', () => {
    const out = pickBoundaryBalances([
      { openingBalance: 100, closingBalance: null },
      { openingBalance: null, closingBalance: null },
      { openingBalance: 999, closingBalance: 500 },
    ]);
    expect(out).toEqual({ openingBalance: 100, closingBalance: 500 });
  });

  it('returns nulls when no chunk has a value', () => {
    expect(pickBoundaryBalances([null, { openingBalance: null, closingBalance: null }]))
      .toEqual({ openingBalance: null, closingBalance: null });
  });

  it('skips null/undefined chunk entries', () => {
    const out = pickBoundaryBalances([undefined, null, { openingBalance: 50, closingBalance: 75 }]);
    expect(out).toEqual({ openingBalance: 50, closingBalance: 75 });
  });
});

describe('reconcileBalances', () => {
  const base = {
    summaryOpening: 0,
    summaryClosing: 49154.62,
    txnOpening: 90117.27,
    txnClosing: 49154.62,
    runningOpening: 90117.27,
    runningClosing: 49154.62,
    totalDebits: 167962.05,
    totalCredits: 126999.40,
  };

  it('prefers labelled transaction boundary rows when both opening and closing are present and reconcile', () => {
    // 90117.27 + 126999.40 - 167962.05 = 49154.62
    const r = reconcileBalances(base);
    expect(r.openingBalance).toBe(90117.27);
    expect(r.closingBalance).toBe(49154.62);
    expect(r.openingSource).toBe('transactions');
    expect(r.closingSource).toBe('transactions');
  });

  it('uses summary balances when no transaction boundary rows are present and summary reconciles', () => {
    const r = reconcileBalances({
      summaryOpening: 1000,
      summaryClosing: 1250,
      txnOpening: null,
      txnClosing: null,
      runningOpening: null,
      runningClosing: null,
      totalDebits: 250,
      totalCredits: 500,
    });
    expect(r.openingSource).toBe('summary');
    expect(r.closingSource).toBe('summary');
    expect(r.openingBalance).toBe(1000);
    expect(r.closingBalance).toBe(1250);
  });

  it('uses labelled opening plus running-balance closing when closing boundary row is absent', () => {
    const r = reconcileBalances({
      summaryOpening: 0,
      summaryClosing: 0,
      txnOpening: 90117.27,
      txnClosing: null,
      runningOpening: 90117.27,
      runningClosing: 49154.62,
      totalDebits: 167962.05,
      totalCredits: 126999.40,
    });
    expect(r.openingBalance).toBe(90117.27);
    expect(r.closingBalance).toBe(49154.62);
    expect(r.openingSource).toBe('transactions');
    expect(r.closingSource).toBe('running_balance');
  });

  it('uses running-balance opening plus labelled closing when opening boundary row is absent', () => {
    const r = reconcileBalances({
      summaryOpening: 0,
      summaryClosing: 49154.62,
      txnOpening: null,
      txnClosing: 49154.62,
      runningOpening: 90117.27,
      runningClosing: 49154.62,
      totalDebits: 167962.05,
      totalCredits: 126999.40,
    });
    expect(r.openingBalance).toBe(90117.27);
    expect(r.closingBalance).toBe(49154.62);
    expect(r.openingSource).toBe('running_balance');
    expect(r.closingSource).toBe('transactions');
  });

  it('uses running balances when both labelled boundary rows are absent and summary is mangled', () => {
    const r = reconcileBalances({
      summaryOpening: 0,
      summaryClosing: 0,
      txnOpening: null,
      txnClosing: null,
      runningOpening: 90117.27,
      runningClosing: 49154.62,
      totalDebits: 167962.05,
      totalCredits: 126999.40,
    });
    expect(r.openingSource).toBe('running_balance');
    expect(r.closingSource).toBe('running_balance');
    expect(r.openingBalance).toBe(90117.27);
    expect(r.closingBalance).toBe(49154.62);
  });

  it('keeps a legitimate zero from the highest-priority reconciled pair', () => {
    const r = reconcileBalances({
      summaryOpening: 50,
      summaryClosing: 0,
      txnOpening: 0,
      txnClosing: 0,
      runningOpening: 0,
      runningClosing: 0,
      totalDebits: 100,
      totalCredits: 100,
    });
    expect(r.openingSource).toBe('transactions');
    expect(r.openingBalance).toBe(0);
  });

  it('returns null/none when all sources are absent', () => {
    const r = reconcileBalances({
      summaryOpening: null,
      summaryClosing: null,
      txnOpening: null,
      txnClosing: null,
      runningOpening: null,
      runningClosing: null,
      totalDebits: 0,
      totalCredits: 0,
    });
    expect(r.openingSource).toBe('none');
    expect(r.closingSource).toBe('none');
    expect(r.openingBalance).toBeNull();
    expect(r.closingBalance).toBeNull();
  });
});
