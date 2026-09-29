/**
 * Summary validation.
 * 
 * Validates extracted summary data against schema and business rules.
 */

import { ValidationResult } from '../parsers/retryEngine';
import type { CCSummary, BankSummary } from '../parsers/extractSummary';
import type { TransactionsOutput } from '../parsers/extractTransactions';
import { ExtractedTransaction } from '@/types/extractedTransaction';
import { debugLog } from '@/lib/utils/debug';
import { parseDate } from '@/lib/parsers/dateParser';

// Coerce an LLM-supplied balance value to number | null. Non-numeric values (strings the model
// sometimes returns) collapse to null rather than poisoning downstream arithmetic.
function coerceNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Validate CC summary.
 */
export function validateCCSummary(summary: unknown): ValidationResult<CCSummary> {
  if (!summary) {
    return {
      valid: false,
      errors: ['Summary is missing'],
      warnings: [],
      data: null
    };
  }

  const s = summary as Partial<CCSummary & { previousBalanceCandidates?: Array<{ label: string; value: number }> }>;
  const errors: string[] = [];
  const warnings: string[] = [];

  // Date format checks - validate and convert to Date objects
  if (s.statementDate !== null && s.statementDate !== undefined) {
    if (typeof s.statementDate === 'string' && !parseDate(s.statementDate)) {
      errors.push(`summary.statementDate is invalid: "${s.statementDate}". Expected format: YYYY-MM-DD, DD/MM/YYYY, or MM/DD/YYYY`);
    }
  }

  if (s.paymentDueDate !== null && s.paymentDueDate !== undefined) {
    if (typeof s.paymentDueDate === 'string' && !parseDate(s.paymentDueDate)) {
      errors.push(`summary.paymentDueDate is invalid: "${s.paymentDueDate}". Expected format: YYYY-MM-DD, DD/MM/YYYY, or MM/DD/YYYY`);
    }
  }

  // Numeric type + range checks
  const ccNumericFields: [string, unknown][] = [
    ['totalDue', s.totalDue],
    ['minimumDue', s.minimumDue],
    ['creditLimit', s.creditLimit],
    ['availableCredit', s.availableCredit],
    ['previousBalance', s.previousBalance],
    ['paymentsReceived', s.paymentsReceived],
    ['purchasesAndCharges', s.purchasesAndCharges],
  ];

  for (const [name, value] of ccNumericFields) {
    if (value !== null && value !== undefined) {
      if (typeof value !== 'number' || isNaN(value)) {
        errors.push(`summary.${name} must be a number, got ${typeof value}: ${JSON.stringify(value)}`);
      } else if (value < 0) {
        errors.push(`summary.${name} must be >= 0`);
      }
    }
  }

  // Cross-field logical checks
  if (
    s.totalDue !== null && s.totalDue !== undefined &&
    s.minimumDue !== null && s.minimumDue !== undefined &&
    s.totalDue < s.minimumDue
  ) {
    errors.push('summary.totalDue must be >= minimumDue');
  }

  if (
    s.availableCredit !== null && s.availableCredit !== undefined &&
    s.creditLimit !== null && s.creditLimit !== undefined &&
    s.availableCredit > s.creditLimit
  ) {
    errors.push('summary.availableCredit must be <= creditLimit');
  }

  // Over-limit previousBalance is often legitimate (fees, interest, over-limit spending),
  // so a strict exceedance is a warning, not a hard error. A field-swap extraction mistake
  // usually makes previousBalance EQUAL creditLimit (which passes below); strict exceedance
  // is more plausibly a real over-limit balance. Keep it as a warning so the signal surfaces
  // without triggering retries that would push the model to corrupt a correct value.
  if (
    s.previousBalance !== null && s.previousBalance !== undefined &&
    s.creditLimit !== null && s.creditLimit !== undefined &&
    s.previousBalance > s.creditLimit
  ) {
    warnings.push(
      'summary.previousBalance > creditLimit — possibly a wrong field extracted ' +
      '(creditLimit or availableCredit grabbed instead), but may be a legitimate over-limit balance'
    );
  }

  // Check that previousBalanceCandidates was populated (helps debug extraction strategy)
  if (!s.previousBalanceCandidates || s.previousBalanceCandidates.length === 0) {
    // Not an error, but worth logging for debugging
    // Some statements genuinely have no previous balance
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    data: s as CCSummary
  };
}

/**
 * Validate bank summary.
 */
export function validateBankSummary(summary: unknown): ValidationResult<BankSummary> {
  if (!summary) {
    return {
      valid: false,
      errors: ['Summary is missing'],
      warnings: [],
      data: null
    };
  }

  const s = summary as Partial<BankSummary>;
  const errors: string[] = [];

  // Date format checks - validate and convert to Date objects
  const dateFields = {
    statementDate: s.statementDate,
    statementPeriodStart: s.statementPeriodStart,
    statementPeriodEnd: s.statementPeriodEnd
  };

  for (const [key, val] of Object.entries(dateFields)) {
    if (val !== null && val !== undefined) {
      if (typeof val === 'string' && !parseDate(val)) {
        errors.push(`summary.${key} is invalid. Expected format: YYYY-MM-DD, DD/MM/YYYY, or MM/DD/YYYY`);
      }
    }
  }

  // openingBalance and closingBalance can be negative (overdraft)
  // No range constraint needed, but type must be number
  const bankNumericFields: [string, unknown][] = [
    ['openingBalance', s.openingBalance],
    ['closingBalance', s.closingBalance],
  ];

  for (const [name, value] of bankNumericFields) {
    if (value !== null && value !== undefined) {
      if (typeof value !== 'number' || isNaN(value)) {
        errors.push(`summary.${name} must be a number, got ${typeof value}: ${JSON.stringify(value)}`);
      }
    }
  }

  // Period ordering check
  if (
    typeof s.statementPeriodStart === 'string' &&
    typeof s.statementPeriodEnd === 'string'
  ) {
    const startDate = parseDate(s.statementPeriodStart);
    const endDate = parseDate(s.statementPeriodEnd);
    if (startDate && endDate && endDate < startDate) {
      errors.push('summary.statementPeriodEnd must be >= statementPeriodStart');
    }
  }

  // Add balance reconciliation warning if transactions have balance data
  // This will be checked in mergeEngine when transactions are available

  return {
    valid: errors.length === 0,
    errors,
    warnings: [],
    data: s as BankSummary
  };
}

/**
 * Validate transactions output.
 */
export function validateTransactions(data: unknown): ValidationResult<TransactionsOutput> {
  // Handle both raw array and wrapped object { transactions: [...] }
  const normalized = Array.isArray(data)
    ? { transactions: data }
    : (data as TransactionsOutput);

  if (!normalized || !Array.isArray(normalized.transactions)) {
    return {
      valid: false,
      errors: ['transactions must be an array'],
      warnings: [],
      data: { transactions: [] }
    };
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  const validTxns: ExtractedTransaction[] = [];

  // Noise row patterns to reject - must match ENTIRE description exactly
  const NOISE_ROW_PATTERNS = [
    /^opening\s+balance\s*$/i,
    /^closing\s+balance\s*$/i,
    /^balance\s+(b\/f|brought\s+forward|c\/f|carried\s+forward)\s*$/i,
    /^total\s+(debit|credit|purchases|payments|charges)\s*$/i,
    /^sub[\s\-]?total\s*$/i,
    /^total\s+.*\s+for\s+the\s+period\s*$/i,
    /^total\s+.*\s+for\s+the\s+month\s*$/i
  ];

  for (let i = 0; i < normalized.transactions.length; i++) {
    const tx = normalized.transactions[i] as Partial<ExtractedTransaction>;

    // Date format check - LLM returns string
    if (!tx.date) {
      errors.push(`Transaction[${i}]: date is missing`);
      continue;
    }

    // Validate the string format (no mutation - conversion happens during parser canonicalization)
    // Be lenient - LLM may return various formats
    if (typeof tx.date !== 'string') {
      errors.push(`Transaction[${i}]: date must be a string`);
      continue;
    }

    const parsed = parseDate(tx.date);
    if (parsed === null) {
      // Don't reject - just warn. LLM date formats can vary.
      warnings.push(`Transaction[${i}]: date "${tx.date}" format not recognized`);
    }

    // Amount check
    if (typeof tx.amount !== 'number' || isNaN(tx.amount)) {
      errors.push(`Transaction[${i}]: amount is not a valid number`);
      continue;
    }

    if (tx.amount <= 0) {
      errors.push(`Transaction[${i}]: amount must be > 0, got ${tx.amount}`);
      continue;
    }

    // Our extraction formatter joins columns with "||" before feeding the text to the LLM.
    // If a returned field still contains "||", the model failed to split the columns and
    // merged adjacent ones (e.g. swallowed the amount column into the description). Reject
    // the row so retryEngine re-prompts with this feedback — do not silently carry the
    // merged value through. Real narration never contains "||".
    if (typeof tx.description === 'string' && tx.description.includes('||')) {
      errors.push(
        `Transaction[${i}]: description "${tx.description}" contains the "||" column delimiter — each || column maps to exactly one field, do not merge columns`,
      );
      continue;
    }

    // Noise row rejection - only reject if description EXACTLY matches pattern
    if (tx.description && NOISE_ROW_PATTERNS.some(p => p.test(tx.description!.trim()))) {
      // Observability: the opening/closing balance rows live in the transaction table for many
      // statements, and the transaction regime (column-extracted) is more reliable than the
      // summary section (whose label/value grid scrambles under PDF text flattening). Log these
      // before dropping so we can confirm the extracted amount/type before wiring them in as a
      // recovery source for the summary pass.
      const descLower = tx.description.trim().toLowerCase();
      if (/^opening\s+balance/.test(descLower) || /^closing\s+balance/.test(descLower)) {
        debugLog('validation', `Balance row dropped: desc="${tx.description}" amount=${tx.amount} type=${tx.type} subType=${tx.transactionSubType ?? '(none)'}`);
      }
      warnings.push(`Transaction[${i}]: "${tx.description}" looks like a balance/total row — skipped`);
      continue;
    }

    // Cross-field consistency: originalCurrency and originalAmount must be both present or both absent
    const hasCurrency = tx.originalCurrency != null;
    const hasAmount = tx.originalAmount != null;
    if (hasCurrency && !hasAmount) {
      warnings.push(`Transaction[${i}] (${tx.date}, ${tx.description}, ₹${tx.amount}): originalCurrency "${tx.originalCurrency}" set but originalAmount is missing`);
    } else if (hasAmount && !hasCurrency) {
      warnings.push(`Transaction[${i}] (${tx.date}, ${tx.description}, ₹${tx.amount}): originalAmount ${tx.originalAmount} set but originalCurrency is missing`);
    }

    // International transactions should have original currency
    if (tx.isInternationalTransaction === true && !hasCurrency) {
      warnings.push(`Transaction[${i}] (${tx.date}, ${tx.description}, ₹${tx.amount}): marked as international but missing originalCurrency`);
    }

    validTxns.push(tx as ExtractedTransaction);
  }

  // DEBUG: Log validation results
  debugLog("ValidationEngine", `Transactions from LLM → ${validTxns.length} valid (${errors.length} errors, ${warnings.length} warnings)`);

  // Additional debugging for better visibility into parsing process
  if (errors.length > 0 || warnings.length > 0) {
    debugLog('validation', `Validation Summary - Errors: ${errors.length}, Warnings: ${warnings.length}`);
    if (errors.length > 0) {
      debugLog('validation', 'Errors:', errors);
    }
    if (warnings.length > 0) {
      debugLog('validation', 'Warnings:', warnings);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    data: {
      transactions: validTxns,
      openingBalance: coerceNullableNumber((normalized as Record<string, unknown>).openingBalance),
      closingBalance: coerceNullableNumber((normalized as Record<string, unknown>).closingBalance),
      // Header side-channel (row-identity spec §3): the transactions pass reads the
      // echoed header line from this field. String or null — anything else is dropped.
      tableHeader: typeof (normalized as Record<string, unknown>).tableHeader === 'string'
        ? (normalized as Record<string, unknown>).tableHeader as string
        : null,
    }
  };
}
