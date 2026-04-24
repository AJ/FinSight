import { parse, isValid, format } from "date-fns"
import { Transaction } from '@/models/Transaction';
import { debugLog } from '@/lib/utils/debug';
import type { CCSummary, BankSummary } from '@/lib/parsers/extractSummary';
import type { ExtractedTransaction } from '@/types/extractedTransaction';

//
// TYPES
//

export interface StatementMeta {
  openingBalance?: number
  closingBalance?: number
  currency?: string
}

// CC-specific metadata for verification
export interface CCStatementMeta {
  previousBalance?: number
  totalDue?: number
  paymentsReceived?: number
  purchasesAndCharges?: number
  interestCharged?: number
  lateFee?: number
  otherCharges?: number
  cashbackEarned?: number
  currency?: string
}

export interface VerifiedTransaction extends Transaction {
  confidence: number
  evidenceAnchor?: number
  verification: {
    amountMatched: boolean
    dateMatched: boolean
    descriptionMatched: boolean
    contextMatched: boolean
    currencyMatched: boolean
  }
}

export interface VerificationReport {
  verified: VerifiedTransaction[]
  rejected: Transaction[]
  duplicates: Transaction[]
  reconciliation: {
    passed: boolean
    computedClosing?: number
    difference?: number
  }
  overallConfidence: number
}

// CC verification report
export interface CCVerificationReport {
  // Approach B: Statement total verification
  statementTotals: {
    passed: boolean
    expectedTotalDue: number
    computedTotalDue: number
    difference: number
    formula: string  // Human-readable formula
  }
  
  // Approach C: Transaction sum verification
  transactionSums: {
    passed: boolean
    totalPurchases: number
    totalPayments: number
    totalFees: number
    totalDebits?: number  // Added for base type comparison
    totalCredits?: number  // Added for base type comparison
    statementPurchases?: number
    statementPayments?: number
    statementFees?: number
  }
  
  // Overall
  overallConfidence: number
  passed: boolean
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
  const verified: VerifiedTransaction[] = []
  const rejected: Transaction[] = []
  const duplicates: Transaction[] = []

  const signatureSet = new Set<string>()

  for (const tx of transactions) {
    const result = verifyTransaction(tx, normalizedText)
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

  const reconciliation = reconcile(verified, meta)

  const overallConfidence = computeOverallConfidence(
    verified,
    reconciliation
  )

  return {
    verified,
    rejected,
    duplicates,
    reconciliation,
    overallConfidence
  }
}

//
// TRANSACTION VERIFICATION
//

function verifyTransaction(
  tx: Transaction,
  rawText: string
): VerifiedTransaction {

  const amountMatched = matchAmount(rawText, tx.amount)
  // Guard against invalid dates from LLM extraction
  const isValidDate = tx.date instanceof Date && !isNaN(tx.date.getTime())
  const dateMatched = isValidDate ? matchDate(rawText, format(tx.date, 'yyyy-MM-dd')) : false
  const descriptionMatched = matchDescription(rawText, tx.description)
  const contextMatch = matchContext(rawText, tx)
  const contextMatched = contextMatch.matched
  const typeMatched = matchType(rawText, tx)  // NEW: Verify credit/debit column
  const currencyMatched = tx.localCurrency
    ? rawText.includes(tx.localCurrency.code.toLowerCase())
    : true

  let confidence = 0

  if (amountMatched) confidence += 30
  if (typeMatched) confidence += 25  // Type match (credit/debit column)
  if (dateMatched) confidence += 20
  if (descriptionMatched) confidence += 15
  if (currencyMatched) confidence += 10

  return Object.assign(Object.create(Transaction.prototype), {
    ...tx,
    confidence,
    evidenceAnchor: contextMatch.anchors[0],
    verification: {
      amountMatched,
      dateMatched,
      descriptionMatched,
      contextMatched,
      currencyMatched,
      typeMatched  // NEW
    }
  }) as VerifiedTransaction;
}

//
// RECONCILIATION
//

function reconcile(
  transactions: Transaction[],
  meta: StatementMeta
) {

  if (
    meta.openingBalance === undefined ||
    meta.closingBalance === undefined
  ) {
    return { passed: false }
  }

  const totalDebits = transactions
    .filter(t => t.type === "debit")
    .reduce((s, t) => s + t.amount, 0)

  const totalCredits = transactions
    .filter(t => t.type === "credit")
    .reduce((s, t) => s + t.amount, 0)

  const computedClosing =
    meta.openingBalance + totalCredits - totalDebits

  const difference = Math.abs(
    computedClosing - meta.closingBalance
  )

  return {
    passed: difference <= AMOUNT_TOLERANCE,
    computedClosing,
    difference
  }
}

//
// CC STATEMENT VERIFICATION (Approach B + C)
//

/**
 * Verify credit card statement using two approaches:
 * - Approach B: Statement totals (Previous + Purchases + Fees - Payments = Total Due)
 * - Approach C: Transaction sums by type
 */
export function verifyCCStatement(
  transactions: Transaction[],
  meta: CCStatementMeta
): CCVerificationReport {
  // Approach B: Verify statement totals
  const statementTotals = verifyCCStatementTotals(transactions, meta)
  
  // Approach C: Verify transaction sums by type
  const transactionSums = verifyCCTransactionSums(transactions, meta)
  
  // Overall confidence
  const passed = statementTotals.passed && transactionSums.passed
  const overallConfidence = calculateCCConfidence(statementTotals, transactionSums)
  
  return {
    statementTotals,
    transactionSums,
    overallConfidence,
    passed
  }
}

function verifyCCStatementTotals(
  transactions: Transaction[],
  meta: CCStatementMeta
): CCVerificationReport['statementTotals'] {
  // Use base credit/debit for balance verification
  const totalDebits = transactions
    .filter(t => t.type === 'debit')
    .reduce((s, t) => s + t.amount, 0)

  const totalCredits = transactions
    .filter(t => t.type === 'credit')
    .reduce((s, t) => s + t.amount, 0)

  // Formula: Previous + Debits - Credits = Total Due
  const computedTotalDue = meta.previousBalance !== undefined
    ? meta.previousBalance + totalDebits - totalCredits
    : 0

  const expectedTotalDue = meta.totalDue ?? 0
  const difference = Math.abs(computedTotalDue - expectedTotalDue)

  // Log sub-type breakdown for debugging
  const subtypeBreakdown = {
    purchases: transactions.filter(t => t.transactionSubType === 'purchase').reduce((s, t) => s + t.amount, 0),
    payments: transactions.filter(t => t.transactionSubType === 'bill_payment').reduce((s, t) => s + t.amount, 0),
    refunds: transactions.filter(t => t.transactionSubType === 'refund').reduce((s, t) => s + t.amount, 0),
    cashback: transactions.filter(t => t.transactionSubType === 'cashback').reduce((s, t) => s + t.amount, 0),
    fees: transactions.filter(t => t.transactionSubType === 'fee').reduce((s, t) => s + t.amount, 0),
    interest: transactions.filter(t => t.transactionSubType === 'interest').reduce((s, t) => s + t.amount, 0),
  }
  debugLog('[CC Verification] Sub-type breakdown:', subtypeBreakdown)
  debugLog('[CC Verification] Base totals:', { totalDebits, totalCredits, computedTotalDue, expectedTotalDue, difference })

  const formula = meta.previousBalance !== undefined
    ? `₹${meta.previousBalance.toFixed(2)} (Previous) + ₹${totalDebits.toFixed(2)} (Debits) - ₹${totalCredits.toFixed(2)} (Credits) = ₹${computedTotalDue.toFixed(2)}`
    : 'Previous balance not available'

  debugLog('[CC Verification] Statement Totals:', {
    previousBalance: meta.previousBalance,
    totalDebits,
    totalCredits,
    computedTotalDue,
    expectedTotalDue,
    difference,
    passed: difference <= AMOUNT_TOLERANCE,
  });

  return {
    passed: difference <= AMOUNT_TOLERANCE,
    expectedTotalDue,
    computedTotalDue,
    difference,
    formula
  }
}

function verifyCCTransactionSums(
  transactions: Transaction[],
  meta: CCStatementMeta
): CCVerificationReport['transactionSums'] {
  // Sum transactions by sub-type (for detailed breakdown)
  const totalPurchases = sumTransactionsBySubType(transactions, ['purchase', 'charge'])
  const totalPayments = sumTransactionsBySubType(transactions, ['bill_payment'])
  const totalFees = sumTransactionsBySubType(transactions, ['fee', 'interest'])
  
  // Sum by base type (for statement column comparison)
  // Statement "Payments/Credits" = ALL credits (payments + refunds + cashback)
  // Statement "Purchases/Debit" = ALL debits (purchases + fees + interest)
  const totalDebits = transactions
    .filter(t => t.type === 'debit')
    .reduce((s, t) => s + t.amount, 0)
  const totalCredits = transactions
    .filter(t => t.type === 'credit')
    .reduce((s, t) => s + t.amount, 0)

  // Compare to statement breakdowns using base type (matches statement column structure)
  const purchasesMatch = meta.purchasesAndCharges !== undefined
    ? Math.abs(totalDebits - meta.purchasesAndCharges) < CATEGORIZATION_TOLERANCE
    : true

  const paymentsMatch = meta.paymentsReceived !== undefined
    ? Math.abs(totalCredits - meta.paymentsReceived) < CATEGORIZATION_TOLERANCE
    : true

  const feesMatch = (meta.interestCharged !== undefined || meta.lateFee !== undefined)
    ? Math.abs(totalFees - ((meta.interestCharged ?? 0) + (meta.lateFee ?? 0))) < CATEGORIZATION_TOLERANCE
    : true

  // Log verification details
  debugLog('[CC Verification] Transaction Sums:', {
    totalPurchases,
    totalPayments,
    totalFees,
    totalDebits,
    totalCredits,
    statementPurchases: meta.purchasesAndCharges,
    statementPayments: meta.paymentsReceived,
    statementFees: (meta.interestCharged ?? 0) + (meta.lateFee ?? 0),
    purchasesMatch,
    paymentsMatch,
    feesMatch,
    passed: purchasesMatch && paymentsMatch && feesMatch,
  });

  return {
    passed: purchasesMatch && paymentsMatch && feesMatch,
    totalPurchases,
    totalPayments,
    totalFees,
    totalDebits,
    totalCredits,
    statementPurchases: meta.purchasesAndCharges,
    statementPayments: meta.paymentsReceived,
    statementFees: (meta.interestCharged ?? 0) + (meta.lateFee ?? 0)
  }
}

function sumTransactionsBySubType(
  transactions: Transaction[],
  subTypes: string[]
): number {
  return transactions
    .filter(t => t.transactionSubType && subTypes.includes(t.transactionSubType))
    .reduce((s, t) => s + t.amount, 0)
}

function calculateCCConfidence(
  statementTotals: CCVerificationReport['statementTotals'],
  transactionSums: CCVerificationReport['transactionSums']
): number {
  let confidence = 0
  
  // Statement totals (50 points)
  if (statementTotals.passed) {
    confidence += 50
  } else if (statementTotals.difference < 100) {
    confidence += 25  // Partial credit for small differences
  }
  
  // Transaction sums (50 points)
  if (transactionSums.passed) {
    confidence += 50
  } else {
    // Partial credit for individual matches
    if (transactionSums.statementPurchases === undefined || 
        Math.abs(transactionSums.totalPurchases - transactionSums.statementPurchases) < CATEGORIZATION_TOLERANCE) {
      confidence += 17
    }
    if (transactionSums.statementPayments === undefined ||
        Math.abs(transactionSums.totalPayments - transactionSums.statementPayments) < CATEGORIZATION_TOLERANCE) {
      confidence += 17
    }
    if (transactionSums.statementFees === undefined ||
        Math.abs(transactionSums.totalFees - transactionSums.statementFees) < CATEGORIZATION_TOLERANCE) {
      confidence += 16
    }
  }
  
  return confidence
}

/**
 * Cross-section validation for CC statements.
 * Compares transaction totals against summary fields.
 */
export function validateCCCrossSection(
  summary: CCSummary,
  transactions: ExtractedTransaction[]
): string[] {
  const warnings: string[] = [];

  if (!summary || !Array.isArray(transactions) || transactions.length === 0) {
    return warnings;
  }

  const totalDebit = transactions
    .filter((t) => t.type === 'debit')
    .reduce((s: number, t) => s + t.amount, 0);

  const totalCredit = transactions
    .filter((t) => t.type === 'credit')
    .reduce((s: number, t) => s + t.amount, 0);

  // CC debit total vs purchasesAndCharges (15% tolerance)
  if (
    summary.purchasesAndCharges !== null &&
    summary.purchasesAndCharges !== undefined &&
    summary.purchasesAndCharges > 0
  ) {
    const debitGap = Math.abs(totalDebit - summary.purchasesAndCharges);
    const debitGapPct = debitGap / summary.purchasesAndCharges;

    if (debitGapPct > 0.15) {
      warnings.push(
        `CC cross-section: transaction debits (${totalDebit.toFixed(2)}) differ from ` +
        `summary purchasesAndCharges (${summary.purchasesAndCharges}) ` +
        `by ${(debitGapPct * 100).toFixed(1)}% — review extraction`
      );
    }
  }

  // CC credit total vs paymentsReceived (15% tolerance)
  if (
    summary.paymentsReceived !== null &&
    summary.paymentsReceived !== undefined &&
    summary.paymentsReceived > 0
  ) {
    const creditGap = Math.abs(totalCredit - summary.paymentsReceived);
    const creditGapPct = creditGap / summary.paymentsReceived;

    if (creditGapPct > 0.15) {
      warnings.push(
        `CC cross-section: transaction credits (${totalCredit.toFixed(2)}) differ from ` +
        `summary paymentsReceived (${summary.paymentsReceived}) ` +
        `by ${(creditGapPct * 100).toFixed(1)}% — review extraction`
      );
    }
  }

  return warnings;
}

/**
 * Cross-section validation for bank statements.
 * Verifies balance equation: opening + credits - debits = closing
 */
export function validateBankCrossSection(
  summary: BankSummary,
  transactions: ExtractedTransaction[]
): string[] {
  const warnings: string[] = [];

  if (!summary || !Array.isArray(transactions) || transactions.length === 0) {
    return warnings;
  }

  if (
    summary.openingBalance === null ||
    summary.openingBalance === undefined ||
    summary.closingBalance === null ||
    summary.closingBalance === undefined
  ) {
    return warnings;
  }

  const totalCredit = transactions
    .filter((t) => t.type === 'credit')
    .reduce((s: number, t) => s + t.amount, 0);

  const totalDebit = transactions
    .filter((t) => t.type === 'debit')
    .reduce((s: number, t) => s + t.amount, 0);

  const calculatedClosing = summary.openingBalance + totalCredit - totalDebit;
  const diff = Math.abs(calculatedClosing - summary.closingBalance);

  if (diff > 1.0) {
    warnings.push(
      `Bank cross-section: openingBalance(${summary.openingBalance}) + ` +
      `credits(${totalCredit.toFixed(2)}) - debits(${totalDebit.toFixed(2)}) = ` +
      `${calculatedClosing.toFixed(2)}, but closingBalance = ${summary.closingBalance} ` +
      `(diff: ${diff.toFixed(2)}) — transactions may be incomplete`
    );
  }

  return warnings;
}

//
// MATCHING LOGIC
//

function matchAmount(raw: string, amount: number): boolean {
  const candidates = generateAmountVariants(amount)
  return candidates.some(c => raw.includes(c))
}

function matchDate(raw: string, dateStr: string): boolean {
  const dateFormats = generateDateVariants(dateStr)
  return dateFormats.some(d => raw.includes(d))
}

function matchDescription(raw: string, desc: string): boolean {
  const normalizedDesc = normalize(desc)
  const words = normalizedDesc.split(" ")
  let matched = 0

  for (const word of words) {
    if (word.length < 3) continue
    if (raw.includes(word)) matched++
  }

  return matched / words.length >= 0.6
}

function matchContext(raw: string, tx: Transaction): {
  matched: boolean
  anchors: number[]
} {
  const amountVariants = generateAmountVariants(tx.amount)
  // Guard against invalid dates
  const isValidDate = tx.date instanceof Date && !isNaN(tx.date.getTime())
  const dateVariants = isValidDate ? generateDateVariants(format(tx.date, 'yyyy-MM-dd')) : []
  const anchors: number[] = []

  for (const amount of amountVariants) {
    let searchStart = 0

    while (searchStart < raw.length) {
      const idx = raw.indexOf(amount, searchStart)
      if (idx === -1) break

      const window = raw.slice(
        Math.max(0, idx - 80),
        idx + 80
      )

      if (dateVariants.some(d => window.includes(d))) {
        anchors.push(idx)
      }

      searchStart = idx + Math.max(1, amount.length)
    }
  }

  const uniqueAnchors = [...new Set(anchors)].sort((a, b) => a - b)
  return {
    matched: uniqueAnchors.length > 0,
    anchors: uniqueAnchors,
  }
}

/**
 * Verify that the transaction type (credit/debit) matches the statement.
 * Handles multiple statement formats:
 * - Separate Credit/Debit columns
 * - +/- signs
 * - CR/DR suffix
 * - Keywords (CREDIT, DEBIT, etc.)
 *
 * Uses date+amount anchors to bound the search to a single transaction row,
 * preventing type keywords from adjacent rows from bleeding in.
 */
function matchType(raw: string, tx: Transaction): boolean {
  const amountVariants = generateAmountVariants(tx.amount)
  const isValidDate = tx.date instanceof Date && !isNaN(tx.date.getTime())
  const dateVariants = isValidDate ? generateDateVariants(format(tx.date, 'yyyy-MM-dd')) : []

  for (const amount of amountVariants) {
    const amountIdx = raw.indexOf(amount)
    if (amountIdx === -1) continue

    // Bound the search to the transaction row: from date to amount + padding
    const rowStart = findRowStart(raw, dateVariants, amountIdx)
    const rowEnd = Math.min(raw.length, amountIdx + amount.length + 20)
    const rowContext = raw.slice(rowStart, rowEnd)

    // Check for Credit/Debit keywords within the transaction row only
    const hasCreditKeyword = /\b(credit|cr|deposit|in)\b/.test(rowContext)
    const hasDebitKeyword = /\b(debit|dr|withdrawal|out|payment)\b/.test(rowContext)

    // Check for CR/DR suffix immediately after amount (row-scoped)
    const hasCRSuffix = new RegExp(`${amount.replace(/[.,]/g, '[$&]')}\\s*(cr|credit)`, 'i').test(rowContext)
    const hasDRSuffix = new RegExp(`${amount.replace(/[.,]/g, '[$&]')}\\s*(dr|debit)`, 'i').test(rowContext)

    // Check for +/- signs (row-scoped)
    const hasPlusSign = new RegExp(`[+]?${amount.replace(/[.,]/g, '[$&]')}`).test(rowContext)
    const hasMinusSign = new RegExp(`[-(]${amount.replace(/[.,]/g, '[$&]')}[)]?`).test(rowContext)

    // Determine type based on evidence
    if (tx.type === 'credit') {
      if (hasCreditKeyword && !hasDebitKeyword) return true
      if (hasCRSuffix) return true
      if (hasPlusSign && !hasMinusSign) return true
      if (hasDebitKeyword && !hasCreditKeyword) return false
      if (hasDRSuffix) return false
    } else {
      if (hasDebitKeyword && !hasCreditKeyword) return true
      if (hasDRSuffix) return true
      if (hasMinusSign) return true
      if (hasCreditKeyword && !hasDebitKeyword) return false
      if (hasCRSuffix) return false
    }
  }

  // If no clear evidence, assume match (don't penalize)
  return true
}

/**
 * Find the start of the transaction row by locating the nearest date
 * before the amount. Falls back to a tight window around the amount
 * if no date anchor is found.
 */
function findRowStart(raw: string, dateVariants: string[], amountIdx: number): number {
  let bestDateIdx = -1

  for (const dateStr of dateVariants) {
    const dateIdx = raw.lastIndexOf(dateStr, amountIdx)
    if (dateIdx !== -1 && dateIdx > bestDateIdx) {
      bestDateIdx = dateIdx
    }
  }

  if (bestDateIdx !== -1) {
    return bestDateIdx
  }

  // No date anchor found — use a tight fallback window
  return Math.max(0, amountIdx - 40)
}

//
// HELPERS
//

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s.,/-]/g, "")
    .replace(/\s+/g, " ")
}

function generateAmountVariants(amount: number): string[] {
  return [
    amount.toFixed(2),
    amount.toLocaleString("en-IN"),
    amount.toLocaleString("en-US"),
    Math.round(amount).toString()
  ]
}

function generateDateVariants(dateStr: string): string[] {
  const formats = [
    "dd/MM/yyyy",
    "MM/dd/yyyy",
    "dd-MM-yyyy",
    "yyyy-MM-dd",
    "d MMM yyyy",
    "dd MMM yyyy"
  ]

  const variants: string[] = []

  for (const fmt of formats) {
    const parsed = parse(dateStr, fmt, new Date())
    if (isValid(parsed)) {
      variants.push(parsed.toLocaleDateString("en-GB"))
      variants.push(parsed.toLocaleDateString("en-US"))
    }
  }

  return [...new Set([dateStr, ...variants])]
}

function createSignature(
  tx: Transaction,
  evidenceAnchor?: number
): string {
  const normalizedDesc = normalize(tx.description).slice(0, 40)
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

  return Math.round(avg + reconciliationBonus)
}


