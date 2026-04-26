/**
 * Merge engine - combines multi-pass outputs into canonical dataset.
 */

import type { ExtractedTransaction } from '@/types/extractedTransaction';
import { validateCCCrossSection, validateBankCrossSection } from './verificationEngine';
import type { StatementExtractionData } from '@/lib/parsers/extractionResult';
import type { CCSummary, BankSummary } from '@/lib/parsers/extractSummary';
import type { TransactionsOutput } from '@/lib/parsers/extractTransactions';
import type { RewardsOutput } from '@/lib/parsers/extractRewards';
import { debugLog } from '@/lib/utils/debug';

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

function deduplicateTransactions(transactions: ExtractedTransaction[]): {
  deduped: ExtractedTransaction[];
  duplicatesRemoved: number;
  potentialDuplicates: Array<{ tx: ExtractedTransaction; matchedWith: ExtractedTransaction }>;
} {
  const result: ExtractedTransaction[] = [];
  const potentialDuplicates: Array<{ tx: ExtractedTransaction; matchedWith: ExtractedTransaction }> = [];

  for (const tx of transactions) {
    const match = result.find(existing => isNearDuplicate(existing, tx));

    if (match) {
      potentialDuplicates.push({ tx, matchedWith: match });
    }
    // Always keep the transaction — what looks like a duplicate may be legitimate
    // (e.g., debit+credit to same merchant, or two genuine charges on the same day).
    result.push(tx);
  }

  if (potentialDuplicates.length > 0) {
    debugLog('mergeEngine', `Found ${potentialDuplicates.length} potential duplicate(s) (keeping all transactions):`);
    potentialDuplicates.forEach(({ tx, matchedWith }, idx) => {
      debugLog('mergeEngine', `  Potential duplicate ${idx + 1}:`);
      debugLog('mergeEngine', `    Tx1: ${matchedWith.date} | ${matchedWith.description} | ₹${matchedWith.amount} | ${matchedWith.type}`);
      debugLog('mergeEngine', `    Tx2: ${tx.date} | ${tx.description} | ₹${tx.amount} | ${tx.type}`);
      debugLog('mergeEngine', `    Similarity: ${compareTwoStrings(tx.description.toLowerCase(), matchedWith.description.toLowerCase()).toFixed(2)}`);
    });
  }

  return { deduped: result, duplicatesRemoved: 0, potentialDuplicates };
}

function isNearDuplicate(a: ExtractedTransaction, b: ExtractedTransaction): boolean {
  const sameAmount = Math.abs(a.amount - b.amount) < 0.01;
  if (!sameAmount) return false;

  const dateA = new Date(a.date).getTime();
  const dateB = new Date(b.date).getTime();
  const dateDiffMs = Math.abs(dateA - dateB);
  if (dateDiffMs !== 0) return false;

  const similarity = compareTwoStrings(
    a.description.toLowerCase(),
    b.description.toLowerCase(),
  );
  return similarity >= 0.95;
}

function computeDerived(transactions: ExtractedTransaction[]): StatementExtractionData['derived'] {
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
    transactionCount: transactions.length,
  };
}

function computeConfidence(warnings: string[]): number {
  let score = 1.0;

  const dedupWarnings = warnings.filter(w => w.includes('potential duplicate'));
  score -= dedupWarnings.length * 0.05;

  const crossWarnings = warnings.filter(w => w.includes('cross-section'));
  score -= crossWarnings.length * 0.1;

  const validationWarnings = warnings.filter(w => w.includes('validation'));
  score -= validationWarnings.length * 0.15;

  const postWarnings = warnings.filter(
    w => w.includes('previousBalance') || w.includes('balance equation'),
  );
  score -= postWarnings.length * 0.2;

  // Summary extraction failure means critical data is missing
  const summaryWarnings = warnings.filter(w => w.includes('Summary extraction failed'));
  score -= summaryWarnings.length * 0.3;

  // Balance reconciliation failure means transaction data doesn't match statement totals
  const reconciliationWarnings = warnings.filter(w => w.includes('Balance reconciliation'));
  score -= reconciliationWarnings.length * 0.2;

  return Math.max(0, Math.min(1, score));
}

export function mergeOutputs(
  statementType: 'credit_card' | 'bank',
  summary: CCSummary | BankSummary | null,
  txData: TransactionsOutput | null,
  rewardsData: RewardsOutput | null,
  upstreamWarnings: string[],
  failedChunks?: string[],
): StatementExtractionData {
  const warnings: string[] = [...upstreamWarnings];

  if (!summary) {
    warnings.push('Summary extraction failed — summary fields will be null');
  }
  if (!txData) {
    warnings.push('Transaction extraction failed — transaction list will be empty');
  }

  const rawTransactions = txData?.transactions ?? [];

  debugLog('mergeEngine', `${statementType}: ${rawTransactions.length} transactions from LLM`);

  const { deduped, potentialDuplicates } = deduplicateTransactions(rawTransactions);

  debugLog('mergeEngine', `${statementType}: ${rawTransactions.length} transactions (${potentialDuplicates.length} potential duplicates flagged, keeping all)`);

  if (potentialDuplicates.length > 0) {
    warnings.push(`Found ${potentialDuplicates.length} potential duplicate transaction(s) — kept all for manual review`);
  }

  const derived = computeDerived(deduped);

  let finalRewards: RewardsOutput | null = null;
  if (statementType === 'credit_card' && rewardsData) {
    finalRewards = rewardsData;
  }

  if (statementType === 'bank' && summary && 'openingBalance' in summary) {
    const bankSummary = summary as BankSummary;
    const transactionsWithBalance = deduped.filter(t => t.balance !== undefined && t.balance !== null);

    if (transactionsWithBalance.length > 0) {
      const firstBalance = transactionsWithBalance[0].balance;
      if (bankSummary.openingBalance !== null && firstBalance !== undefined && firstBalance !== null) {
        const balanceDiff = Math.abs(firstBalance - bankSummary.openingBalance);
        if (balanceDiff > 1.0) {
          warnings.push(
            `Balance reconciliation: first transaction balance (${firstBalance}) does not match opening balance (${bankSummary.openingBalance}) — diff: ${balanceDiff}`,
          );
        }
      }

      const lastBalance = transactionsWithBalance[transactionsWithBalance.length - 1].balance;
      if (bankSummary.closingBalance !== null && lastBalance !== undefined && lastBalance !== null) {
        const balanceDiff = Math.abs(lastBalance - bankSummary.closingBalance);
        if (balanceDiff > 1.0) {
          warnings.push(
            `Balance reconciliation: last transaction balance (${lastBalance}) does not match closing balance (${bankSummary.closingBalance}) — diff: ${balanceDiff}`,
          );
        }
      }
    }
  }

  let crossWarnings: string[] = [];
  if (summary) {
    if (statementType === 'credit_card' && 'totalDue' in summary) {
      crossWarnings = validateCCCrossSection(summary, deduped);
    } else if (statementType === 'bank' && 'accountNumber' in summary) {
      crossWarnings = validateBankCrossSection(summary, deduped);
    }
  }
  warnings.push(...crossWarnings);

  const confidence = computeConfidence(warnings);

  return {
    statementType,
    summary: summary ?? null,
    transactions: deduped,
    rewards: finalRewards,
    derived,
    meta: {
      warnings,
      confidence,
      failedChunks,
    },
  };
}
