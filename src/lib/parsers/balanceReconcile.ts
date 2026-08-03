// Reconcile opening/closing balances from independent extraction sources.
//
// Explicit labelled boundary rows from the transaction table are strongest. Summary fields are
// useful but can be corrupted by PDF label/value grid flattening. Running balances are a weaker
// fallback: they are not labelled opening/closing rows, but they are statement-provided balances
// and can rescue statements where only one boundary row is present.

const TOLERANCE = 1.0; // Rs 1 - matches the recon engine's AMOUNT_TOLERANCE

type Balance = number | null | undefined;
type Source = 'transactions' | 'summary' | 'running_balance' | 'none';

export interface BalanceReconcileInput {
  summaryOpening: Balance;
  summaryClosing: Balance;
  txnOpening: Balance;
  txnClosing: Balance;
  runningOpening: Balance;
  runningClosing: Balance;
  totalDebits: number;
  totalCredits: number;
}

export interface BalanceReconcileResult {
  openingBalance: number | null;
  closingBalance: number | null;
  openingSource: Source;
  closingSource: Source;
  warning?: string;
}

interface Candidate {
  value: number;
  source: Exclude<Source, 'none'>;
  priority: number;
}

function isNum(x: Balance): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function candidates(...values: Array<{ value: Balance; source: Candidate['source']; priority: number }>): Candidate[] {
  return values
    .filter((v): v is { value: number; source: Candidate['source']; priority: number } => isNum(v.value))
    .map(v => ({ value: v.value, source: v.source, priority: v.priority }));
}

function balanceMatches(opening: number, closing: number, totalCredits: number, totalDebits: number): boolean {
  return Math.abs((opening + totalCredits - totalDebits) - closing) <= TOLERANCE;
}

/**
 * Pick opening (first non-null chunk) and closing (last non-null chunk) from a chunk run.
 * The opening-balance row is in the first chunk; the closing-balance row is in the last.
 */
export function pickBoundaryBalances(
  outputs: Array<{ openingBalance?: Balance; closingBalance?: Balance } | null | undefined>,
): { openingBalance: number | null; closingBalance: number | null } {
  let opening: number | null = null;
  let closing: number | null = null;
  for (const o of outputs) {
    if (!o) continue;
    if (opening === null && isNum(o.openingBalance)) opening = o.openingBalance;
    if (isNum(o.closingBalance)) closing = o.closingBalance; // keep updating -> last non-null wins
  }
  return { openingBalance: opening, closingBalance: closing };
}

export function reconcileBalances(input: BalanceReconcileInput): BalanceReconcileResult {
  const openingCandidates = candidates(
    { value: input.txnOpening, source: 'transactions', priority: 0 },
    { value: input.summaryOpening, source: 'summary', priority: 1 },
    { value: input.runningOpening, source: 'running_balance', priority: 2 },
  );
  const closingCandidates = candidates(
    { value: input.txnClosing, source: 'transactions', priority: 0 },
    { value: input.summaryClosing, source: 'summary', priority: 1 },
    { value: input.runningClosing, source: 'running_balance', priority: 2 },
  );

  let bestPair: { opening: Candidate; closing: Candidate; score: number } | null = null;
  for (const opening of openingCandidates) {
    for (const closing of closingCandidates) {
      if (!balanceMatches(opening.value, closing.value, input.totalCredits, input.totalDebits)) continue;
      const score = opening.priority + closing.priority;
      if (!bestPair || score < bestPair.score) {
        bestPair = { opening, closing, score };
      }
    }
  }

  const fallbackOpening = openingCandidates[0] ?? null;
  const fallbackClosing = closingCandidates[0] ?? null;
  const opening = bestPair?.opening ?? fallbackOpening;
  const closing = bestPair?.closing ?? fallbackClosing;

  const warningParts: string[] = [];
  if (isNum(input.txnOpening) && isNum(input.summaryOpening) && Math.abs(input.txnOpening - input.summaryOpening) > TOLERANCE) {
    warningParts.push(`Opening balance differs between transaction boundary (${input.txnOpening}) and summary (${input.summaryOpening}); used ${opening?.source ?? 'none'} (${opening?.value ?? 'null'}).`);
  }
  if (isNum(input.txnClosing) && isNum(input.summaryClosing) && Math.abs(input.txnClosing - input.summaryClosing) > TOLERANCE) {
    warningParts.push(`Closing balance differs between transaction boundary (${input.txnClosing}) and summary (${input.summaryClosing}); used ${closing?.source ?? 'none'} (${closing?.value ?? 'null'}).`);
  }
  if (!bestPair && opening && closing) {
    warningParts.push(`No balance source pair reconciled within ${TOLERANCE}; used highest-priority available sources.`);
  }

  return {
    openingBalance: opening?.value ?? null,
    closingBalance: closing?.value ?? null,
    openingSource: opening?.source ?? 'none',
    closingSource: closing?.source ?? 'none',
    warning: warningParts.length > 0 ? warningParts.join(' ') : undefined,
  };
}
