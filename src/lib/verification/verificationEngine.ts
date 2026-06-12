import { parse, isValid, format } from "date-fns"
import { Transaction } from '@/models/Transaction';
import { SourceType } from '@/models/SourceType';
import { debugLog } from '@/lib/utils/debug';
import { parseStructuredRows, parseCellAmount, determineTypeFromColumns } from './structuredRowParser';
import type { StructuredRow } from './structuredRowParser';

//
// TYPES
//

export type StatementMeta =
  | { kind: 'bank'; openingBalance?: number; closingBalance?: number; currency?: string }
  | {
      kind: 'credit_card';
      previousBalance?: number;
      totalDue?: number;
      paymentsReceived?: number;
      purchasesAndCharges?: number;
      interestCharged?: number;
      lateFee?: number;
      otherCharges?: number;
      cashbackEarned?: number;
      currency?: string;
    };

export interface VerifiedTransaction extends Transaction {
  confidence: number
  evidenceAnchor?: number
  verification: {
    amountMatched: boolean
    dateMatched: boolean
    descriptionMatched: boolean
    contextMatched: boolean
    typeMatched: boolean
  }
}

export interface VerificationReport {
  verified: VerifiedTransaction[]
  rejected: Transaction[]
  duplicates: Transaction[]
  reconciliation: {
    passed: boolean
    computed?: number
    fromStatement?: number
    difference?: number
  }
  ccAggregate?: {
    statementTotals: {
      passed: boolean
      computedTotalDue: number
      statementTotalDue: number
    }
    transactionSums: {
      passed: boolean
      totalDebits: number
      totalCredits: number
      totalFees: number
      statementPurchases?: number
      statementPayments?: number
      statementFees?: number
    }
  }
  overallConfidence: number
}

//
// CONFIGURATION
//

const AMOUNT_TOLERANCE = 1.0         // ₹1 for balance verification (handles statement rounding)
const MIN_CONFIDENCE_ACCEPT = 75     // 75% confidence threshold
const CATEGORIZATION_TOLERANCE = 10  // ₹10 for categorization matches

//
// PUBLIC ENTRY
//

export function verifyStatement(
  rawText: string,
  transactions: Transaction[],
  meta: StatementMeta
): VerificationReport {

  const normalizedText = normalize(rawText)
  const structured = parseStructuredRows(rawText)

  debugLog('verification', `parseStructuredRows result: ${structured ? `rows=${structured.rows.length} headers=${structured.headers.join(',')} delimiter=${structured.delimiter}` : 'null'}`);
  if (!structured) {
    const lines = rawText.split('\n').filter(l => l.trim());
    const hasPipes = lines.filter(l => l.includes('||')).length;
    debugLog('verification', `parseStructuredRows null reason: totalLines=${lines.length} linesWith||=${hasPipes} first3=${lines.slice(0, 3).join(' | ')}`);
  }

  const verified: VerifiedTransaction[] = []
  const rejected: Transaction[] = []
  const duplicates: Transaction[] = []

  const signatureSet = new Set<string>()
  const usedRowIndices = structured ? new Set<number>() : null;
  const usedPositions = new Set<number>();

  for (const tx of transactions) {
    let result: VerifiedTransaction;

    if (structured && usedRowIndices) {
      result = verifyTransactionStructured(tx, structured.rows, usedRowIndices, normalizedText, usedPositions);
    } else {
      result = verifyTransactionProgressive(tx, normalizedText, usedPositions);
    }

    debugLog('verification', `Transaction "${tx.description?.substring(0, 40)}" | amount=${tx.amount} type=${tx.type}`, {
      amountMatched: result.verification.amountMatched,
      dateMatched: result.verification.dateMatched,
      descriptionMatched: result.verification.descriptionMatched,
      typeMatched: result.verification.typeMatched,
      contextMatched: result.verification.contextMatched,
      confidence: result.confidence,
      verdict: result.confidence >= MIN_CONFIDENCE_ACCEPT ? 'VERIFIED' : 'REJECTED',
    });

    const signature = createSignature(tx, result.evidenceAnchor)

    if (signatureSet.has(signature)) {
      duplicates.push(tx)
      continue
    }

    if (result.confidence >= MIN_CONFIDENCE_ACCEPT) {
      signatureSet.add(signature)
      verified.push(result)
    } else {
      rejected.push(tx)
    }
  }

  const reconciliation = reconcile(transactions, meta)

  const ccAggregate = meta.kind === 'credit_card'
    ? buildCCAggregate(transactions, meta, reconciliation)
    : undefined

  const overallConfidence = ccAggregate
    ? computeCCOverallConfidence(verified, reconciliation, ccAggregate)
    : computeOverallConfidence(verified, reconciliation)

  return {
    verified,
    rejected,
    duplicates,
    reconciliation,
    ...(ccAggregate ? { ccAggregate } : {}),
    overallConfidence
  }
}

//
// PROGRESSIVE RAW TEXT MATCHING
//

function verifyTransactionProgressive(
  tx: Transaction,
  rawText: string,
  usedPositions: Set<number>,
): VerifiedTransaction {
  const amountVariants = generateAmountVariants(tx.amount);
  const candidates: Array<{ position: number; context: string }> = [];

  for (const variant of amountVariants) {
    let searchStart = 0;
    while (searchStart < rawText.length) {
      const idx = rawText.indexOf(variant, searchStart);
      if (idx === -1) break;
      searchStart = idx + Math.max(1, variant.length);
      if (usedPositions.has(idx)) continue;
      // Reject substring matches inside larger numbers: "500" must not match inside "49500"
      const before = idx > 0 ? rawText[idx - 1] : ' ';
      const afterIdx = idx + variant.length;
      const after = afterIdx < rawText.length ? rawText[afterIdx] : ' ';
      if (/\d/.test(before) || /\d/.test(after)) continue;
      const lineStart = rawText.lastIndexOf('\n', idx);
      const lineEnd = rawText.indexOf('\n', idx);
      const contextStart = lineStart === -1 ? Math.max(0, idx - 80) : lineStart;
      const contextEnd = lineEnd === -1 ? Math.min(rawText.length, idx + 40) : lineEnd;
      candidates.push({
        position: idx,
        context: rawText.slice(contextStart, contextEnd),
      });
    }
  }

  if (candidates.length === 0) {
    return makeVerifiedTransaction(tx, 0, undefined, {
      amountMatched: false, dateMatched: false, descriptionMatched: false,
      contextMatched: false, typeMatched: false,
    });
  }

  // Progressive filtering
  let filtered = candidates;

  // Type filter — keep candidates where type isn't contradicted
  const typeFiltered = filtered.filter(c => {
    const typeEvidence = checkTypeEvidence(c.context, tx, amountVariants);
    return typeEvidence.kind !== 'contradicted';
  });
  if (typeFiltered.length > 0) filtered = typeFiltered;

  if (filtered.length === 1) {
    return scoreCandidate(tx, filtered[0], usedPositions, amountVariants);
  }

  // Date filter
  const isValidDate = tx.date instanceof Date && !isNaN(tx.date.getTime());
  if (isValidDate) {
    const dateVariants = generateDateVariants(format(tx.date, 'yyyy-MM-dd'));
    const dateFiltered = filtered.filter(c =>
      dateVariants.some(d => c.context.includes(d.toLowerCase()))
    );
    if (dateFiltered.length > 0) filtered = dateFiltered;
  }

  if (filtered.length === 1) {
    return scoreCandidate(tx, filtered[0], usedPositions, amountVariants);
  }

  // Score remaining by description
  let bestCandidate = filtered[0];
  let bestScore = -1;
  for (const candidate of filtered) {
    const score = scoreDescriptionMatch(candidate.context, tx);
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  return scoreCandidate(tx, bestCandidate, usedPositions, amountVariants);
}

type TypeEvidence =
  | { kind: 'structural' }   // CR/DR suffix or +/- sign — strongest signal
  | { kind: 'keyword' }      // Keyword match — weaker signal
  | { kind: 'cc_payment' }   // CC payment context bypass
  | { kind: 'none' }         // No evidence either way
  | { kind: 'contradicted' }; // Evidence opposes the transaction type

function checkTypeEvidence(context: string, tx: Transaction, amountVariants: string[]): TypeEvidence {
  const hasCreditKeyword = /\b(credit|cr|deposit|in|received|refund)\b/.test(context);
  const hasDebitKeyword = /\b(debit|dr|withdrawal|out|paid|sent|payment\s+to)\b/.test(context);
  const hasCCPaymentContext =
    tx.sourceType === SourceType.CreditCard &&
    /\b(payment|paid|billpay|autopay|neft|imps|upi|rtgs)\b/.test(context) &&
    /\b(cc|card|credit\s+card|bill|payment)\b/.test(context);

  const escaped = amountVariants.map(v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  const hasCRSuffix = escaped.some(v =>
    new RegExp(`${v}\\s*(cr|credit)`, 'i').test(context)
  );
  const hasDRSuffix = escaped.some(v =>
    new RegExp(`${v}\\s*(dr|debit)`, 'i').test(context)
  );

  const hasMinusSign = escaped.some(v =>
    new RegExp(`[-(]${v}`).test(context)
  );
  const hasPlusSign = escaped.some(v =>
    new RegExp(`\\+${v}`).test(context)
  );

  if (tx.type === 'credit') {
    if (hasCCPaymentContext) return { kind: 'cc_payment' };
    if (hasCRSuffix) return { kind: 'structural' };
    if (hasPlusSign) return { kind: 'structural' };
    if (hasCreditKeyword && !hasDebitKeyword) return { kind: 'keyword' };
    if (hasDRSuffix) return { kind: 'contradicted' };
    if (hasDebitKeyword && !hasCreditKeyword) return { kind: 'contradicted' };
  } else {
    if (hasDRSuffix) return { kind: 'structural' };
    if (hasMinusSign) return { kind: 'structural' };
    if (hasDebitKeyword && !hasCreditKeyword) return { kind: 'keyword' };
    if (hasCRSuffix) return { kind: 'contradicted' };
    if (hasCreditKeyword && !hasDebitKeyword) return { kind: 'contradicted' };
  }
  return { kind: 'none' };
}

function scoreDescriptionMatch(context: string, tx: Transaction): number {
  const normalizedDesc = normalize(tx.description ?? '').replace(/\n/g, ' ');
  const words = normalizedDesc.split(' ').filter(w => w.length >= 3);
  if (words.length === 0) return 0;
  let matched = 0;
  for (const word of words) {
    if (context.includes(word)) matched++;
  }
  return matched / words.length;
}

function scoreCandidate(
  tx: Transaction,
  candidate: { position: number; context: string },
  usedPositions: Set<number>,
  amountVariants: string[],
): VerifiedTransaction {
  usedPositions.add(candidate.position);

  const amountMatched = true;
  const typeResult = checkTypeEvidence(candidate.context, tx, amountVariants);
  const typeMatched = typeResult.kind !== 'none' && typeResult.kind !== 'contradicted';

  const isValidDate = tx.date instanceof Date && !isNaN(tx.date.getTime());
  const dateMatched = isValidDate
    ? generateDateVariants(format(tx.date, 'yyyy-MM-dd')).some(d =>
        candidate.context.includes(d.toLowerCase())
      )
    : false;

  const descriptionMatched = scoreDescriptionMatch(candidate.context, tx) >= 0.6;

  let confidence = 0;
  if (amountMatched) confidence += 34;
  // Tiered type scoring — keyword matching is inherently noisy (e.g. "payment" appears in
  // both debit and credit contexts), so keyword/cc_payment/none evidence gets half the weight
  // of structural (column-position) evidence. This prevents weak type signals from inflating
  // confidence past the 75 threshold on their own.
  // structural: 28 (column position proves type), keyword/cc_payment/none: 14, contradicted: 0
  if (typeResult.kind === 'structural') {
    confidence += 28;
  } else if (typeResult.kind === 'keyword' || typeResult.kind === 'cc_payment' || typeResult.kind === 'none') {
    confidence += 14;
  }
  if (dateMatched) confidence += 23;
  if (descriptionMatched) confidence += 15;

  return makeVerifiedTransaction(tx, confidence, candidate.position, {
    amountMatched,
    dateMatched,
    descriptionMatched,
    contextMatched: true,
    typeMatched,
  });
}

//
// STRUCTURED ROW MATCHING
//

function verifyTransactionStructured(
  tx: Transaction,
  rows: StructuredRow[],
  usedRowIndices: Set<number>,
  normalizedText: string,
  usedPositions: Set<number>,
): VerifiedTransaction {
  const match = findBestMatchingRow(rows, tx.amount, tx, usedRowIndices);

  if (!match) {
    return verifyTransactionProgressive(tx, normalizedText, usedPositions);
  }

  const { row } = match;

  const amountMatched = true;
  const dateMatched = matchDateField(row, tx);
  const descriptionMatched = matchDescriptionField(row, tx);
  const typeResult = matchTypeField(row, tx);
  const typeMatched = typeResult === true;

  let confidence = 0;
  if (amountMatched) confidence += 34;
  if (typeMatched) confidence += 28;
  if (dateMatched) confidence += 23;
  if (descriptionMatched) confidence += 15;

  if (confidence < MIN_CONFIDENCE_ACCEPT) {
    // Structured match found but confidence too low (e.g., ambiguous type).
    // Release the row and try progressive matching — it may find better evidence.
    return verifyTransactionProgressive(tx, normalizedText, usedPositions);
  }

  usedRowIndices.add(row.rowIndex);
  return makeVerifiedTransaction(tx, confidence, row.rowIndex, {
    amountMatched, dateMatched, descriptionMatched,
    contextMatched: true, typeMatched,
  });
}

function findBestMatchingRow(
  rows: StructuredRow[],
  amount: number,
  tx: Transaction,
  usedRowIndices: Set<number>,
): { row: StructuredRow; score: number } | null {
  const candidates = rows.filter(row => !usedRowIndices.has(row.rowIndex));

  let best: { row: StructuredRow; score: number } | null = null;

  for (const row of candidates) {
    const debitVal = parseCellAmount(row.cells['debit'] ?? '');
    const creditVal = parseCellAmount(row.cells['credit'] ?? '');
    const amountVal = parseCellAmount(row.cells['amount'] ?? '');

    const debitMatches = !isNaN(debitVal) && Math.abs(debitVal - amount) < 0.01;
    const creditMatches = !isNaN(creditVal) && Math.abs(creditVal - amount) < 0.01;
    const amountMatches = !isNaN(amountVal) && Math.abs(amountVal - amount) < 0.01;

    if (!debitMatches && !creditMatches && !amountMatches) continue;

    let score = 0;
    if (matchDateField(row, tx)) score += 2;
    if (matchDescriptionField(row, tx)) score += 1;

    if (!best || score > best.score) {
      best = { row, score };
    }
  }

  return best;
}

function matchDateField(row: StructuredRow, tx: Transaction): boolean {
  const dateCell = row.cells['date'] ?? '';
  if (!dateCell) return false;

  const isValidDate = tx.date instanceof Date && !isNaN(tx.date.getTime());
  if (!isValidDate) return false;

  const dateVariants = generateDateVariants(format(tx.date, 'yyyy-MM-dd'));
  const cellLower = dateCell.toLowerCase();
  return dateVariants.some(d => cellLower.includes(d.toLowerCase()));
}

function matchDescriptionField(row: StructuredRow, tx: Transaction): boolean {
  const descCell = row.cells['description'] ?? '';
  if (!descCell) return false;

  const normalizedDesc = normalize(tx.description ?? '').replace(/\n/g, ' ');
  const normalizedCell = normalize(descCell).replace(/\n/g, ' ');
  const words = normalizedDesc.split(' ').filter(w => w.length >= 3);

  if (words.length === 0) return false;

  let matched = 0;
  for (const word of words) {
    if (normalizedCell.includes(word)) matched++;
  }
  return matched / words.length >= 0.6;
}

function matchTypeField(row: StructuredRow, tx: Transaction): boolean | null {
  const inferredType = determineTypeFromColumns(row.cells, tx.amount);
  if (inferredType === null) return null;
  return inferredType === tx.type;
}

function makeVerifiedTransaction(
  tx: Transaction,
  confidence: number,
  evidenceAnchor: number | undefined,
  verification: VerifiedTransaction['verification'],
): VerifiedTransaction {
  return Object.assign(Object.create(Transaction.prototype), {
    ...tx,
    confidence,
    evidenceAnchor,
    verification,
  }) as VerifiedTransaction;
}

//
// RECONCILIATION
//

function reconcile(
  transactions: Transaction[],
  meta: StatementMeta
): VerificationReport['reconciliation'] {

  if (meta.kind === 'credit_card') {
    if (meta.previousBalance === undefined || meta.totalDue === undefined) {
      return { passed: false };
    }
    const totalDebits = transactions.filter(t => t.type === "debit").reduce((s, t) => s + t.amount, 0);
    const totalCredits = transactions.filter(t => t.type === "credit").reduce((s, t) => s + t.amount, 0);
    const computedClosing = meta.previousBalance + totalDebits - totalCredits;
    const difference = Math.abs(computedClosing - meta.totalDue);
    return {
      passed: difference <= AMOUNT_TOLERANCE,
      computed: computedClosing,
      fromStatement: meta.totalDue,
      difference,
    };
  }

  // Bank reconciliation
  if (meta.openingBalance === undefined || meta.closingBalance === undefined) {
    return { passed: false };
  }

  const totalDebits = transactions.filter(t => t.type === "debit").reduce((s, t) => s + t.amount, 0);
  const totalCredits = transactions.filter(t => t.type === "credit").reduce((s, t) => s + t.amount, 0);
  debugLog('verification', `Reconcile bank: opening=${meta.openingBalance} credits=${totalCredits} debits=${totalDebits} closing=${meta.closingBalance}`);
  const computedClosing = meta.openingBalance + totalCredits - totalDebits;
  const difference = Math.abs(computedClosing - meta.closingBalance);

  return {
    passed: difference <= AMOUNT_TOLERANCE,
    computed: computedClosing,
    fromStatement: meta.closingBalance,
    difference,
  };
}

//
// CC AGGREGATE VERIFICATION
//

function buildCCAggregate(
  transactions: Transaction[],
  meta: Extract<StatementMeta, { kind: 'credit_card' }>,
  reconciliation: VerificationReport['reconciliation'],
): NonNullable<VerificationReport['ccAggregate']> {
  // Decompose by subtype for like-for-like comparison
  const totalDebits = transactions.filter(t => t.type === 'debit').reduce((s, t) => s + t.amount, 0);
  const totalCredits = transactions.filter(t => t.type === 'credit').reduce((s, t) => s + t.amount, 0);

  // Debit breakdown
  const totalPurchases = sumBySubType(transactions, 'debit', ['purchase']);
  const totalFees = sumBySubType(transactions, 'debit', ['fee', 'interest']);

  // Credit breakdown
  const totalPayments = sumBySubType(transactions, 'credit', ['debt_payment']);

  // Statement-side sums (full debit/credit stacks)
  const statementDebits = (meta.purchasesAndCharges ?? 0)
    + (meta.interestCharged ?? 0)
    + (meta.lateFee ?? 0)
    + (meta.otherCharges ?? 0);
  const statementCredits = (meta.paymentsReceived ?? 0)
    + (meta.cashbackEarned ?? 0);

  // Like-for-like comparisons
  // Primary: full debit/credit totals against full statement sums
  const debitTotalsMatch = meta.purchasesAndCharges !== undefined
    ? Math.abs(totalDebits - statementDebits) < CATEGORIZATION_TOLERANCE
    : true;
  const creditTotalsMatch = meta.paymentsReceived !== undefined
    ? Math.abs(totalCredits - statementCredits) < CATEGORIZATION_TOLERANCE
    : true;

  // Secondary: subtype-level breakdown (only meaningful when subtypes are assigned)
  const purchasesMatch = meta.purchasesAndCharges !== undefined && totalPurchases > 0
    ? Math.abs(totalPurchases - meta.purchasesAndCharges) < CATEGORIZATION_TOLERANCE
    : true;
  const feesMatch = (meta.interestCharged !== undefined || meta.lateFee !== undefined) && totalFees > 0
    ? Math.abs(totalFees - ((meta.interestCharged ?? 0) + (meta.lateFee ?? 0))) < CATEGORIZATION_TOLERANCE
    : true;
  const paymentsMatch = meta.paymentsReceived !== undefined && totalPayments > 0
    ? Math.abs(totalPayments - meta.paymentsReceived) < CATEGORIZATION_TOLERANCE
    : true;

  const ccAggregate = {
    statementTotals: {
      passed: reconciliation.passed,
      computedTotalDue: reconciliation.computed ?? 0,
      statementTotalDue: reconciliation.fromStatement ?? 0,
    },
    transactionSums: {
      passed: debitTotalsMatch && creditTotalsMatch && purchasesMatch && feesMatch && paymentsMatch,
      totalDebits,
      totalCredits,
      totalFees,
      statementPurchases: meta.purchasesAndCharges,
      statementPayments: meta.paymentsReceived,
      statementFees: (meta.interestCharged ?? 0) + (meta.lateFee ?? 0),
    },
  };

  debugLog('[CC Verification] Final verdict:', {
    statementTotalsPassed: ccAggregate.statementTotals.passed,
    transactionSumsPassed: ccAggregate.transactionSums.passed,
    purchasesMatch,
    feesMatch,
    paymentsMatch,
    debitTotalsMatch,
    creditTotalsMatch,
    breakdown: { totalPurchases, totalFees, totalPayments, statementDebits, statementCredits },
  });

  return ccAggregate;
}

function sumBySubType(
  transactions: Transaction[],
  type: 'debit' | 'credit',
  subTypes: string[],
): number {
  return transactions
    .filter(t => t.type === type && t.transactionSubType !== undefined && subTypes.includes(t.transactionSubType))
    .reduce((s, t) => s + t.amount, 0);
}

function computeCCOverallConfidence(
  verified: VerifiedTransaction[],
  reconciliation: VerificationReport['reconciliation'],
  ccAggregate: NonNullable<VerificationReport['ccAggregate']>,
): number {
  // Use plain average without reconciliation bonus — reconciliation is already weighted in
  // via statementTotalsConfidence (25%), so including the bonus here would double-count it.
  const transactionConfidence = verified.length === 0
    ? 0
    : verified.reduce((s, t) => s + t.confidence, 0) / verified.length;
  const statementTotalsConfidence = reconciliation.passed
    ? 100
    : reconciliation.difference !== undefined && reconciliation.difference < 100
      ? 50
      : 0;

  const sums = ccAggregate.transactionSums;
  let transactionSumsConfidence = 0;
  if (sums.passed) {
    transactionSumsConfidence = 100;
  } else {
    // Partial credit per comparison axis
    if (sums.statementPurchases === undefined ||
        Math.abs(sums.totalDebits - (sums.statementPurchases ?? 0)) < CATEGORIZATION_TOLERANCE) {
      transactionSumsConfidence += 34;
    }
    if (sums.statementPayments === undefined ||
        Math.abs(sums.totalCredits - (sums.statementPayments ?? 0)) < CATEGORIZATION_TOLERANCE) {
      transactionSumsConfidence += 33;
    }
    if (sums.statementFees === undefined ||
        Math.abs(sums.totalFees - (sums.statementFees ?? 0)) < CATEGORIZATION_TOLERANCE) {
      transactionSumsConfidence += 33;
    }
  }

  return Math.round(
    transactionConfidence * 0.5 +
    statementTotalsConfidence * 0.25 +
    transactionSumsConfidence * 0.25,
  );
}

//
// HELPERS
//

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s.,/|\-\n]/g, "")
    .replace(/[ \t]+/g, " ")
}

function generateAmountVariants(amount: number): string[] {
  return [
    amount.toFixed(2),
    amount.toLocaleString("en-IN"),
    amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    amount.toLocaleString("en-US"),
    amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    amount.toFixed(0),
  ]
}

function generateDateVariants(dateStr: string): string[] {
  const parseFormats = [
    "dd/MM/yyyy",
    "MM/dd/yyyy",
    "dd-MM-yyyy",
    "yyyy-MM-dd",
    "d MMM yyyy",
    "dd MMM yyyy"
  ]

  const outputFormats = [
    "dd/MM/yyyy",
    "MM/dd/yyyy",
    "dd-MM-yyyy",
    "yyyy-MM-dd",
    "dd MMM yyyy",
    "d MMM yyyy",
  ]

  const variants: string[] = []

  for (const fmt of parseFormats) {
    const parsed = parse(dateStr, fmt, new Date())
    if (isValid(parsed)) {
      for (const outFmt of outputFormats) {
        variants.push(format(parsed, outFmt))
      }
      break
    }
  }

  return [...new Set([dateStr, ...variants])]
}

function createSignature(
  tx: Transaction,
  evidenceAnchor?: number
): string {
  const normalizedDesc = normalize(tx.description).replace(/\n/g, " ").slice(0, 40)
  const amountKey = Number(tx.amount).toFixed(2)
  const anchorKey = Number.isFinite(evidenceAnchor)
    ? Math.floor((evidenceAnchor as number) / 8).toString()
    : "na"

  return `${tx.date}|${amountKey}|${tx.type}|${normalizedDesc}|${anchorKey}`
}

function computeOverallConfidence(
  verified: VerifiedTransaction[],
  reconciliation: { passed: boolean }
): number {
  if (verified.length === 0) return 0

  const avg =
    verified.reduce((s, t) => s + t.confidence, 0) /
    verified.length

  const reconciliationBonus = reconciliation.passed ? 15 : 0

  return Math.min(100, Math.round(avg + reconciliationBonus))
}
