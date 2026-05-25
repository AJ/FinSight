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

  // CRITICAL: previousBalance must be <= creditLimit
  if (
    s.previousBalance !== null && s.previousBalance !== undefined &&
    s.creditLimit !== null && s.creditLimit !== undefined &&
    s.previousBalance > s.creditLimit
  ) {
    errors.push(
      'summary.previousBalance must be <= creditLimit — ' +
      'likely wrong field extracted (creditLimit or availableCredit grabbed instead)'
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
    warnings: [],
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

    // Noise row rejection - only reject if description EXACTLY matches pattern
    if (tx.description && NOISE_ROW_PATTERNS.some(p => p.test(tx.description!.trim()))) {
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
    data: { transactions: validTxns }
  };
}
