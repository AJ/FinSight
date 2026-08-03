import { BucketedTransactions } from './routing';

export function computeInflow(buckets: BucketedTransactions): number {
  return buckets.inflow.reduce((sum, t) => sum + t.amount, 0);
}

export function computeOutflow(buckets: BucketedTransactions): number {
  const debits = buckets.outflow.reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const offsets = buckets.outflowOffset.reduce((sum, t) => sum + Math.abs(t.amount), 0);
  return debits - offsets;
}

export function computeInvestments(buckets: BucketedTransactions): number {
  return buckets.investments.reduce((sum, t) => sum + Math.abs(t.amount), 0);
}

export function computeDebtPayments(buckets: BucketedTransactions): number {
  return buckets.debtPayments.reduce((sum, t) => sum + Math.abs(t.amount), 0);
}

export function computeNetCashFlow(buckets: BucketedTransactions): number {
  return computeInflow(buckets)
    - computeOutflow(buckets)
    - computeInvestments(buckets)
    - computeDebtPayments(buckets);
}

export function computeNetCashRate(buckets: BucketedTransactions): number {
  const inflow = computeInflow(buckets);
  if (inflow === 0) return 0;
  return (computeNetCashFlow(buckets) / inflow) * 100;
}
