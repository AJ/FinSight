import { parse, isValid } from "date-fns"

//
// TYPES
//

export type TxType = "debit" | "credit"

export interface ParsedTransaction {
  id?: string
  date: string
  description: string
  amount: number
  type: TxType
  currency?: string
}

export interface StatementMeta {
  openingBalance?: number
  closingBalance?: number
  currency?: string
}

export interface VerifiedTransaction extends ParsedTransaction {
  confidence: number
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
  rejected: ParsedTransaction[]
  duplicates: ParsedTransaction[]
  reconciliation: {
    passed: boolean
    computedClosing?: number
    difference?: number
  }
  overallConfidence: number
}

//
// CONFIGURATION
//

const AMOUNT_TOLERANCE = 0.01
const MIN_CONFIDENCE_ACCEPT = 75

//
// PUBLIC ENTRY
//

export function verifyStatement(
  rawText: string,
  parsed: ParsedTransaction[],
  meta: StatementMeta
): VerificationReport {

  const normalizedText = normalize(rawText)
  const verified: VerifiedTransaction[] = []
  const rejected: ParsedTransaction[] = []
  const duplicates: ParsedTransaction[] = []

  const signatureSet = new Set<string>()

  for (const tx of parsed) {
    const result = verifyTransaction(tx, normalizedText)

    const signature = createSignature(tx)

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
  tx: ParsedTransaction,
  rawText: string
): VerifiedTransaction {

  const amountMatched = matchAmount(rawText, tx.amount)
  const dateMatched = matchDate(rawText, tx.date)
  const descriptionMatched = matchDescription(rawText, tx.description)
  const contextMatched = matchContext(rawText, tx)
  const currencyMatched = tx.currency
    ? rawText.includes(tx.currency)
    : true

  let confidence = 0

  if (amountMatched) confidence += 35
  if (dateMatched) confidence += 20
  if (descriptionMatched) confidence += 20
  if (contextMatched) confidence += 15
  if (currencyMatched) confidence += 10

  return {
    ...tx,
    confidence,
    verification: {
      amountMatched,
      dateMatched,
      descriptionMatched,
      contextMatched,
      currencyMatched
    }
  }
}

//
// RECONCILIATION
//

function reconcile(
  transactions: ParsedTransaction[],
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

function matchContext(raw: string, tx: ParsedTransaction): boolean {
  const amountVariants = generateAmountVariants(tx.amount)
  const dateVariants = generateDateVariants(tx.date)

  for (const amount of amountVariants) {
    const idx = raw.indexOf(amount)
    if (idx === -1) continue

    const window = raw.slice(
      Math.max(0, idx - 50),
      idx + 50
    )

    if (dateVariants.some(d => window.includes(d))) {
      return true
    }
  }

  return false
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

function createSignature(tx: ParsedTransaction): string {
  return `${tx.date}|${tx.amount}|${tx.description.slice(0, 20)}`
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