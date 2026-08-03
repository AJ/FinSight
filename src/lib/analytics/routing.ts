import { Transaction } from '@/models/Transaction';
import { SourceType } from '@/models/SourceType';
import type { TransactionSubType } from '@/models/Transaction';

export type TransactionBucket =
  | 'inflow'
  | 'outflow'
  | 'outflowOffset'
  | 'investments'
  | 'debtPayments'
  | 'excluded'
  | 'ccInvisible';

export interface BucketedTransactions {
  inflow: Transaction[];
  outflow: Transaction[];
  outflowOffset: Transaction[];
  investments: Transaction[];
  debtPayments: Transaction[];
  excluded: Transaction[];
  ccInvisible: Transaction[];
}

// Per-direction bucket pair for one subtype. The `Record<TransactionSubType, …>`
// shape forces a row for every subtype, so adding a subtype is a compile error in
// BOTH BANK_ROUTING and CC_ROUTING — no silent fallthrough to a default bucket
// (the bug this module used to have via `?? ''` + a trailing `else`).
interface SubtypeRouting {
  debit: TransactionBucket;
  credit: TransactionBucket;
}

// Bank routing — subtype → (debit, credit) bucket, exhaustive (spec §3.2).
// `adjustment` is direction-driven (debit→outflow, credit→inflow). Direction-
// restricted subtypes (purchase/income/refund/…) carry the bucket their valid
// direction yields; the wrong direction is blocked upstream by
// subtype_direction_mismatch, so these entries are only reached for valid combos.
const BANK_ROUTING: Record<TransactionSubType, SubtypeRouting> = {
  purchase:      { debit: 'outflow',      credit: 'outflowOffset' },
  bank_charge:   { debit: 'outflow',      credit: 'outflowOffset' },
  charge:        { debit: 'outflow',      credit: 'outflowOffset' },
  refund:        { debit: 'outflow',      credit: 'outflowOffset' },
  income:        { debit: 'outflow',      credit: 'inflow' },
  interest:      { debit: 'outflow',      credit: 'inflow' },
  rewards:       { debit: 'outflow',      credit: 'inflow' },
  withdrawal:    { debit: 'excluded',     credit: 'excluded' },
  debt_payment:  { debit: 'debtPayments', credit: 'inflow' },
  investment:    { debit: 'investments',  credit: 'investments' },
  self_transfer: { debit: 'excluded',     credit: 'excluded' },
  adjustment:    { debit: 'outflow',      credit: 'inflow' },
};

// CC routing — a credit card is a liability account, so it diverges from bank on
// both directions (spec §3.2): credits reduce the bill (not income), the bill
// payment (credit debt_payment) → ccInvisible, and a cash advance (debit
// withdrawal) is new debt → outflow. Same exhaustive Record shape as bank.
const CC_ROUTING: Record<TransactionSubType, SubtypeRouting> = {
  purchase:      { debit: 'outflow',      credit: 'outflowOffset' },
  bank_charge:   { debit: 'outflow',      credit: 'outflowOffset' },
  charge:        { debit: 'outflow',      credit: 'outflowOffset' },
  refund:        { debit: 'outflow',      credit: 'outflowOffset' },
  income:        { debit: 'outflow',      credit: 'outflowOffset' },
  interest:      { debit: 'outflow',      credit: 'outflowOffset' },
  rewards:       { debit: 'outflow',      credit: 'outflowOffset' },
  withdrawal:    { debit: 'outflow',      credit: 'excluded' },
  debt_payment:  { debit: 'debtPayments', credit: 'ccInvisible' },
  investment:    { debit: 'investments',  credit: 'investments' },
  self_transfer: { debit: 'excluded',     credit: 'excluded' },
  adjustment:    { debit: 'outflow',      credit: 'outflowOffset' },
};

/**
 * Route a transaction to its analytics bucket — purely by transactionSubType
 * (+ direction + sourceType). The router never consults the category (spec §3.2).
 *
 * Throws on an absent or unknown subtype rather than silently defaulting: the
 * producer guarantee (spec §3.4) makes a subtype always present on rows that
 * reach here, and the closed routing tables cover every canonical subtype, so a
 * throw signals a real contract violation (or un-migrated legacy data) instead of
 * a wrong bucket.
 */
export function routeTransaction(txn: Transaction): TransactionBucket {
  const sub = txn.transactionSubType;
  if (!sub) {
    throw new Error(`Cannot route transaction without a subtype (id=${txn.id})`);
  }
  const table = txn.sourceType === SourceType.CreditCard ? CC_ROUTING : BANK_ROUTING;
  const row = table[sub];
  if (!row) {
    throw new Error(`Unknown transaction subtype "${sub}" — not in the routing table (id=${txn.id})`);
  }
  return txn.isDebit ? row.debit : row.credit;
}

export function bucketTransactions(transactions: Transaction[]): BucketedTransactions {
  const result: BucketedTransactions = {
    inflow: [],
    outflow: [],
    outflowOffset: [],
    investments: [],
    debtPayments: [],
    excluded: [],
    ccInvisible: [],
  };

  const debugCounts: Record<string, number> = {};

  for (const txn of transactions) {
    const bucket = routeTransaction(txn);
    result[bucket].push(txn);
    if (typeof window !== 'undefined') {
      debugCounts[bucket] = (debugCounts[bucket] ?? 0) + 1;
    }
  }

  if (typeof window !== 'undefined' && transactions.length > 0) {
    const totals: Record<string, number> = {};
    for (const [bucket, txns] of Object.entries(result)) {
      totals[bucket] = (txns as Transaction[]).reduce((sum: number, t: Transaction) => sum + t.amount, 0);
    }
    console.log('[Routing]', debugCounts, 'totals:', Object.fromEntries(
      Object.entries(totals).map(([k, v]) => [k, v.toFixed(2)])
    ));
  }

  return result;
}
