/**
 * Summary validation.
 * 
 * Validates extracted summary data against schema and business rules.
 */

import { ValidationResult } from '../parsers/retryEngine';
import type { CCSummary, BankSummary } from '../parsers/extractSummary';
import type { TransactionsOutput } from '../parsers/extractTransactions';
import { ExtractedTransaction } from '@/types/extractedTransaction';
import { Transaction } from '@/models/Transaction';

// Accept multiple date formats:
// YYYY-MM-DD, YYYY/MM/DD (ISO, international)
// DD/MM/YYYY, DD-MM-YYYY, DD/MM/YY, DD-MM-YY (European/Indian)
// MM/DD/YYYY, MM-DD-YYYY, MM/DD/YY, MM-DD-YY (US)
// DD Mon, YYYY / DD Mon YYYY / DD-Mon-YYYY (e.g., "02 Nov, 2025", "02-Nov-2025")
const DATE_REGEX = /^\d{4}[-\/]\d{2}[-\/]\d{2}$|^\d{2}[-\/]\d{2}[-\/]\d{2,4}$|^\d{1,2}\s+[A-Za-z]{3}[, ]+\d{4}$|^\d{1,2}[-][A-Za-z]{3}[-]\d{4}$/;

// Month name mapping
const MONTH_NAMES: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
};

/**
 * Parse date string to Date object. Supports multiple formats.
 * Returns null if invalid.
 */
function parseDate(dateStr: string): Date | null {
  if (!DATE_REGEX.test(dateStr)) {
    return null;
  }

  // Handle month name formats: "02 Nov, 2025", "02 Nov 2025", "02-Nov-2025"
  const monthNameMatch = dateStr.match(/^(\d{1,2})\s*[- ]?\s*([A-Za-z]{3})\s*[, ]?\s*(\d{4})$/);
  if (monthNameMatch) {
    const day = parseInt(monthNameMatch[1], 10);
    const monthStr = monthNameMatch[2].toLowerCase();
    const year = parseInt(monthNameMatch[3], 10);
    const month = MONTH_NAMES[monthStr];
    
    if (month === undefined || day < 1 || day > 31 || year < 1900 || year > 2100) {
      return null;
    }
    
    const date = new Date(year, month, day);
    if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
      return null;
    }
    return date;
  }

  // Normalize separators
  const normalized = dateStr.replace(/\//g, '-');
  const parts = normalized.split('-');

  if (parts.length !== 3) return null;

  let year: number, month: number, day: number;

  // Determine format based on part lengths and values
  if (parts[0].length === 4) {
    // YYYY-MM-DD or YYYY-DD-MM (assume YYYY-MM-DD)
    year = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10) - 1;
    day = parseInt(parts[2], 10);
  } else if (parts[2].length === 4) {
    // DD/MM/YYYY or MM/DD/YYYY
    // Heuristic: if first part > 12, it's DD/MM/YYYY
    // If second part > 12, it's MM/DD/YYYY
    const first = parseInt(parts[0], 10);
    const second = parseInt(parts[1], 10);

    if (first > 12) {
      // DD/MM/YYYY
      day = first;
      month = second - 1;
    } else if (second > 12) {
      // MM/DD/YYYY
      month = first - 1;
      day = second;
    } else {
      // Ambiguous - assume DD/MM/YYYY (international standard)
      day = first;
      month = second - 1;
    }
    year = parseInt(parts[2], 10);
  } else {
    // YY-MM-DD or similar - assume YY is year
    year = parseInt(parts[0], 10);
    // Handle 2-digit years (assume 20xx for now)
    if (year < 100) year += 2000;
    month = parseInt(parts[1], 10) - 1;
    day = parseInt(parts[2], 10);
  }

  // Validate ranges
  if (month < 0 || month > 11 || day < 1 || day > 31 || year < 1900 || year > 2100) {
    return null;
  }

  const date = new Date(year, month, day);
  // Verify the date is valid (catches invalid dates like Feb 30)
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
    return null;
  }

  return date;
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

  // Numeric range checks
  if (s.totalDue !== null && s.totalDue !== undefined && s.totalDue < 0) {
    errors.push('summary.totalDue must be >= 0');
  }

  if (s.minimumDue !== null && s.minimumDue !== undefined && s.minimumDue < 0) {
    errors.push('summary.minimumDue must be >= 0');
  }

  if (s.creditLimit !== null && s.creditLimit !== undefined && s.creditLimit < 0) {
    errors.push('summary.creditLimit must be >= 0');
  }

  if (s.availableCredit !== null && s.availableCredit !== undefined && s.availableCredit < 0) {
    errors.push('summary.availableCredit must be >= 0');
  }

  if (s.previousBalance !== null && s.previousBalance !== undefined && s.previousBalance < 0) {
    errors.push('summary.previousBalance must be >= 0');
  }

  if (s.paymentsReceived !== null && s.paymentsReceived !== undefined && s.paymentsReceived < 0) {
    errors.push('summary.paymentsReceived must be >= 0');
  }

  if (s.purchasesAndCharges !== null && s.purchasesAndCharges !== undefined && s.purchasesAndCharges < 0) {
    errors.push('summary.purchasesAndCharges must be >= 0');
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
  // No range constraint needed

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
  const validTxns: Transaction[] = [];
  const inputCount = normalized.transactions.length;

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
    const tx = normalized.transactions[i] as Partial<Transaction>;

    // Date format check - LLM returns string
    if (!tx.date) {
      errors.push(`Transaction[${i}]: date is missing`);
      continue;
    }

    // Validate the string format (no mutation - conversion happens in llmParser)
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

    validTxns.push(tx as Transaction);
  }

  // DEBUG: Log validation results
  console.log(`[ValidationEngine] ${inputCount} transactions from LLM → ${validTxns.length} valid (${errors.length} errors, ${warnings.length} warnings)`);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    data: { transactions: validTxns as unknown as ExtractedTransaction[] }
  };
}
