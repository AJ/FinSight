/**
 * Merge engine - combines multi-pass outputs into canonical dataset.
 * 
 * Responsibilities:
 * 1. Deduplicate transactions
 * 2. Resolve conflicts
 * 3. Cross-link rewards to transactions
 * 4. Compute derived totals
 * 5. Cross-section validation
 * 6. Confidence scoring
 */

import { validateCCCrossSection, validateBankCrossSection } from './verificationEngine';
import type { CCSummary, BankSummary } from '@/lib/parsers/extractSummary';
import type { TransactionsOutput } from '@/lib/parsers/extractTransactions';
import type { RewardsOutput } from '@/lib/parsers/extractRewards';
import { Transaction } from '@/models/Transaction';
import { debugLog } from '@/lib/utils/debug';

/**
 * Simple string similarity comparison (Dice coefficient).
 * Returns value between 0 and 1, where 1 is exact match.
 */
function compareTwoStrings(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigramsA = new Set<string>();
  const bigramsB = new Set<string>();

  for (let i = 0; i < a.length - 1; i++) {
    bigramsA.add(a.substring(i, i + 2));
  }
  for (let i = 0; i < b.length - 1; i++) {
    bigramsB.add(b.substring(i, i + 2));
  }

  const intersection = new Set([...bigramsA].filter(x => bigramsB.has(x)));

  return (2 * intersection.size) / (bigramsA.size + bigramsB.size);
}

export interface FinalOutput {
  statementType: 'credit_card' | 'bank';
  summary: CCSummary | BankSummary | null;
  transactions: Transaction[];
  rewards: RewardsOutput | null;
  derived: {
    totalDebit: number;
    totalCredit: number;
    transactionCount: number;
  };
  meta: {
    warnings: string[];
    confidence: number;
  };
}

/**
 * Deduplicate transactions using fuzzy matching.
 * Three signals: amount match, date within ±1 day, description similarity ≥0.85
 * 
 * NOTE: We no longer remove duplicates - we just log them for review.
 * What looks like a duplicate may be a legitimate second transaction
 * (e.g., multiple UPI payments, transaction + reversal, etc.)
 */
function deduplicateTransactions(transactions: Transaction[]): {
  deduped: Transaction[];
  duplicatesRemoved: number;
} {
  const result: Transaction[] = [];
  const potentialDuplicates: Array<{ tx: Transaction; matchedWith: Transaction }> = [];

  for (const tx of transactions) {
    const match = result.find(existing => isNearDuplicate(existing, tx));

    if (match) {
      // Log potential duplicate but DON'T remove it
      potentialDuplicates.push({ tx, matchedWith: match });
    }
    // Always keep the transaction
    result.push(tx);
  }

  // Log potential duplicates for debugging
  if (potentialDuplicates.length > 0) {
    debugLog('mergeEngine', 'Found potential duplicates (keeping all transactions):');
    potentialDuplicates.forEach(({ tx, matchedWith }, idx) => {
      debugLog('mergeEngine', `  Potential Duplicate ${idx + 1}:`);
      debugLog('mergeEngine', `    Tx1: ${tx.date} | ${tx.description} | ₹${tx.amount} | ${tx.type}`);
      debugLog('mergeEngine', `    Tx2: ${matchedWith.date} | ${matchedWith.description} | ₹${matchedWith.amount} | ${matchedWith.type}`);
      debugLog('mergeEngine', `    Similarity: ${compareTwoStrings(tx.description.toLowerCase(), matchedWith.description.toLowerCase()).toFixed(2)}`);
    });
  }

  // Return all transactions - no longer removing any
  return { deduped: result, duplicatesRemoved: 0 };
  
  /* OLD CODE - Removed duplicates instead of logging
  const result: Transaction[] = [];
  let duplicatesRemoved = 0;

  for (const tx of transactions) {
    const isDup = result.some(existing => isNearDuplicate(existing, tx));

    if (isDup) {
      duplicatesRemoved++;
    } else {
      result.push(tx);
    }
  }

  return { deduped: result, duplicatesRemoved };
  */
}

function isNearDuplicate(a: Transaction, b: Transaction): boolean {
  // Signal 1: Amount match (within floating point tolerance)
  const sameAmount = Math.abs(a.amount - b.amount) < 0.01;
  if (!sameAmount) return false;

  // Signal 2: Date within ±1 day
  const dateA = new Date(a.date).getTime();
  const dateB = new Date(b.date).getTime();
  const dateDiffDays = Math.abs(dateA - dateB) / (1000 * 60 * 60 * 24);
  if (dateDiffDays > 1) return false;

  // Signal 3: Description similarity ≥0.85
  const similarity = compareTwoStrings(
    a.description.toLowerCase(),
    b.description.toLowerCase()
  );
  return similarity >= 0.85;
}

/**
 * Compute derived totals from transactions.
 */
function computeDerived(transactions: Transaction[]): {
  totalDebit: number;
  totalCredit: number;
  transactionCount: number;
} {
  let totalDebit = 0;
  let totalCredit = 0;

  for (const tx of transactions) {
    if (tx.type === 'debit') {
      totalDebit += tx.amount;
    } else {
      totalCredit += tx.amount;
    }
  }

  return {
    totalDebit: Math.round(totalDebit * 100) / 100,
    totalCredit: Math.round(totalCredit * 100) / 100,
    transactionCount: transactions.length
  };
}

/**
 * Compute confidence score based on warnings.
 */
function computeConfidence(warnings: string[]): number {
  let score = 1.0;

  // Deduplication warnings
  const dedupWarnings = warnings.filter(w => w.includes('Deduplication'));
  score -= dedupWarnings.length * 0.05;

  // Cross-section warnings
  const crossWarnings = warnings.filter(w => w.includes('cross-section'));
  score -= crossWarnings.length * 0.1;

  // Validation warnings
  const validationWarnings = warnings.filter(w => w.includes('validation'));
  score -= validationWarnings.length * 0.15;

  // Post-pipeline check failures
  const postWarnings = warnings.filter(
    w => w.includes('previousBalance') || w.includes('balance equation')
  );
  score -= postWarnings.length * 0.2;

  return Math.max(0, Math.min(1, score));
}

/**
 * Merge outputs from multiple passes.
 */
export function mergeOutputs(
  statementType: 'credit_card' | 'bank',
  summary: CCSummary | BankSummary | null,
  txData: TransactionsOutput | null,
  rewardsData: RewardsOutput | null,
  upstreamWarnings: string[]
): FinalOutput {
  const warnings: string[] = [...upstreamWarnings];

  // Null guard upstream pass failures
  if (!summary) {
    warnings.push('Summary extraction failed — summary fields will be null');
  }
  if (!txData) {
    warnings.push('Transaction extraction failed — transaction list will be empty');
  }

  // Step 1: Deduplicate transactions
  const rawTransactions: Transaction[] = (txData?.transactions as unknown as Transaction[]) ?? [];

  // DEBUG: Log transaction count before deduplication
  debugLog('mergeEngine', `${statementType}: ${rawTransactions.length} transactions from LLM`);

  const { deduped, duplicatesRemoved } = deduplicateTransactions(rawTransactions);

  // DEBUG: Log transaction count after deduplication
  debugLog('mergeEngine', `${statementType}: ${deduped.length} transactions after deduplication (removed ${duplicatesRemoved} duplicates)`);

  if (duplicatesRemoved > 0) {
    warnings.push(`Deduplication removed ${duplicatesRemoved} near-duplicate transaction(s)`);
  }

  // Step 2: Compute derived totals
  const derived = computeDerived(deduped);

  // Step 3: Link rewards to transactions (CC only)
  let finalRewards: RewardsOutput | null = null;

  if (statementType === 'credit_card' && rewardsData) {
    finalRewards = rewardsData;
    // Reward linking is informational — not implemented for current schema
    warnings.push(...[]);
  }

  // Step 4: Balance reconciliation (bank statements only)
  if (statementType === 'bank' && summary && 'openingBalance' in summary) {
    const bankSummary = summary as BankSummary;
    const transactionsWithBalance = deduped.filter(t => t.balance !== undefined && t.balance !== null);
    
    if (transactionsWithBalance.length > 0) {
      // Check first transaction balance matches opening balance
      const firstBalance = transactionsWithBalance[0].balance;
      if (bankSummary.openingBalance !== null && firstBalance !== undefined) {
        const balanceDiff = Math.abs(firstBalance - bankSummary.openingBalance);
        if (balanceDiff > 1.0) {
          warnings.push(
            `Balance reconciliation: first transaction balance (${firstBalance}) ` +
            `does not match opening balance (${bankSummary.openingBalance}) — diff: ${balanceDiff}`
          );
        }
      }
      
      // Check last transaction balance matches closing balance
      const lastBalance = transactionsWithBalance[transactionsWithBalance.length - 1].balance;
      if (bankSummary.closingBalance !== null && lastBalance !== undefined) {
        const balanceDiff = Math.abs(lastBalance - bankSummary.closingBalance);
        if (balanceDiff > 1.0) {
          warnings.push(
            `Balance reconciliation: last transaction balance (${lastBalance}) ` +
            `does not match closing balance (${bankSummary.closingBalance}) — diff: ${balanceDiff}`
          );
        }
      }
    }
  }

  // Step 5: Cross-section totals check (warning only)
  let crossWarnings: string[] = [];
  if (summary) {
    if (statementType === 'credit_card' && 'totalDue' in summary) {
      crossWarnings = validateCCCrossSection(summary, deduped);
    } else if (statementType === 'bank' && 'accountNumber' in summary) {
      crossWarnings = validateBankCrossSection(summary, deduped);
    }
  }
  warnings.push(...crossWarnings);

  // Step 5: Compute confidence score
  const confidence = computeConfidence(warnings);

  return {
    statementType,
    summary: summary ?? null,
    transactions: deduped,
    rewards: finalRewards,
    derived,
    meta: { warnings, confidence }
  };
}
