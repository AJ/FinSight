/**
 * Anomaly Detection Algorithm
 *
 * Detects unusual transactions using statistical analysis:
 * - Amount anomalies (per-category z-score)
 * - Duplicate transactions (same amount, similar merchant, within window)
 * - Frequency anomalies (multiple charges to same merchant)
 */

import { Transaction, FrequencyPeriod, AnomalyType } from '@/types';
import { AnomalyDetail, CategoryStats, ANOMALY_CONFIG } from './types';

/**
 * Calculate per-category statistics for amount anomaly detection
 */
export function calculateCategoryStats(
  transactions: Transaction[]
): Record<string, CategoryStats> {
  const byCategory: Record<string, number[]> = {};

  // Group amounts by category (expenses only for meaningful stats)
  for (const txn of transactions) {
    if (!txn.isExpense) continue;
    const categoryId = txn.category?.id || 'uncategorized';
    if (!byCategory[categoryId]) {
      byCategory[categoryId] = [];
    }
    byCategory[categoryId].push(Math.abs(txn.amount));
  }

  // Calculate stats for each category
  const stats: Record<string, CategoryStats> = {};
  for (const [category, amounts] of Object.entries(byCategory)) {
    if (amounts.length < ANOMALY_CONFIG.minTransactionsForStats) continue;

    const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const variance =
      amounts.reduce((sum, a) => sum + Math.pow(a - mean, 2), 0) / amounts.length;
    const stdDev = Math.sqrt(variance);

    // Skip categories with zero std dev (all same amount)
    if (stdDev === 0) continue;

    stats[category] = { count: amounts.length, mean, stdDev };
  }

  return stats;
}

/**
 * Calculate Levenshtein-based string similarity (0-1)
 */
export function stringSimilarity(a: string, b: string): number {
  const s1 = a.toLowerCase().trim();
  const s2 = b.toLowerCase().trim();

  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  const matrix: number[][] = [];
  for (let i = 0; i <= s1.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= s2.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  const distance = matrix[s1.length][s2.length];
  const maxLen = Math.max(s1.length, s2.length);
  return 1 - distance / maxLen;
}

/**
 * Calculate hours between two dates
 */
function hoursBetween(d1: Date | string, d2: Date | string): number {
  const date1 = d1 instanceof Date ? d1 : new Date(d1);
  const date2 = d2 instanceof Date ? d2 : new Date(d2);
  const msPerHour = 60 * 60 * 1000;
  return Math.abs(date1.getTime() - date2.getTime()) / msPerHour;
}

/**
 * Extract merchant name from description (simplified)
 * Takes first few words, removes common prefixes
 */
export function extractMerchant(description: string): string {
  return description
    .replace(/^[A-Z]{2,4}\s*\*?\s*/i, '') // Remove codes like "AMZN *", "GOOG *"
    .replace(/^\d+\s+/, '') // Remove leading numbers
    .split(/\s+/)
    .slice(0, 3)
    .join(' ')
    .toLowerCase();
}

/**
 * Detect amount anomaly for a single transaction
 */
export function detectAmountAnomaly(
  txn: Transaction,
  categoryStats: Record<string, CategoryStats>
): AnomalyDetail | null {
  if (!txn.isExpense) return null;

  const stats = categoryStats[txn.category?.id || 'uncategorized'];
  if (!stats || stats.stdDev === 0) return null;

  const amount = Math.abs(txn.amount);
  const deviation = (amount - stats.mean) / stats.stdDev;

  if (deviation > ANOMALY_CONFIG.amountStdDevThreshold) {
    return { type: 'high_amount', amountDeviation: deviation };
  }

  if (deviation < -ANOMALY_CONFIG.amountStdDevThreshold) {
    return { type: 'low_amount', amountDeviation: deviation };
  }

  return null;
}

/**
 * Detect duplicate transaction
 */
export function detectDuplicate(
  txn: Transaction,
  allTransactions: Transaction[]
): AnomalyDetail | null {
  if (!txn.isExpense) return null;

  const txnDate = txn.date instanceof Date ? txn.date : new Date(txn.date);

  const candidates = allTransactions.filter((t) => {
    if (t.id === txn.id || !t.isExpense) return false;

    // Exact amount match (±$0.01)
    if (Math.abs(Math.abs(t.amount) - Math.abs(txn.amount)) > 0.01) return false;

    // Within time window
    const hours = hoursBetween(t.date, txnDate);
    if (hours > ANOMALY_CONFIG.duplicateWindowHours) return false;

    // Similar merchant/description
    const similarity = stringSimilarity(t.description, txn.description);
    return similarity >= ANOMALY_CONFIG.duplicateMerchantSimilarity;
  });

  if (candidates.length > 0) {
    return { type: 'duplicate', duplicateOf: candidates[0].id };
  }

  return null;
}

/**
 * Detect frequency anomaly (multiple charges to same merchant)
 */
export function detectFrequencyAnomaly(
  txn: Transaction,
  allTransactions: Transaction[]
): AnomalyDetail | null {
  if (!txn.isExpense) return null;

  const txnDate = txn.date instanceof Date ? txn.date : new Date(txn.date);
  const merchant = extractMerchant(txn.description);

  // Count transactions in 24h window
  const count24h = allTransactions.filter((t) => {
    if (t.id === txn.id || !t.isExpense) return false;
    const hours = hoursBetween(t.date, txnDate);
    if (hours > 24) return false;
    return extractMerchant(t.description) === merchant;
  }).length;

  // Check 24h threshold (include current transaction)
  if (count24h + 1 >= ANOMALY_CONFIG.frequencyThreshold24h) {
    return {
      type: 'unusual_frequency',
      frequencyCount: count24h + 1,
      frequencyPeriod: FrequencyPeriod.TwentyFourHours,
    };
  }

  // Count transactions in 7d window
  const count7d = allTransactions.filter((t) => {
    if (t.id === txn.id || !t.isExpense) return false;
    const hours = hoursBetween(t.date, txnDate);
    if (hours > 24 * 7) return false;
    return extractMerchant(t.description) === merchant;
  }).length;

  // Check 7d threshold (include current transaction)
  if (count7d + 1 >= ANOMALY_CONFIG.frequencyThreshold7d) {
    return {
      type: 'unusual_frequency',
      frequencyCount: count7d + 1,
      frequencyPeriod: FrequencyPeriod.SevenDays,
    };
  }

  return null;
}

/**
 * Run full anomaly detection on all transactions
 * Returns updated transactions with anomaly flags
 */
export function detectAnomalies(transactions: Transaction[]): Transaction[] {
  const categoryStats = calculateCategoryStats(transactions);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Transaction: TxnClass } = require('@/types');

  return transactions.map((txn) => {
    const anomalies: AnomalyDetail[] = [];

    // Check for amount anomaly
    const amountAnomaly = detectAmountAnomaly(txn, categoryStats);
    if (amountAnomaly) anomalies.push(amountAnomaly);

    // Check for duplicate
    const duplicateAnomaly = detectDuplicate(txn, transactions);
    if (duplicateAnomaly) anomalies.push(duplicateAnomaly);

    // Check for frequency anomaly
    const frequencyAnomaly = detectFrequencyAnomaly(txn, transactions);
    if (frequencyAnomaly) anomalies.push(frequencyAnomaly);

    // No anomalies detected - clear flags
    if (anomalies.length === 0) {
      return new TxnClass(
        txn.id,
        txn.date,
        txn.description,
        txn.amount,
        txn.type,
        txn.category,
        txn.balance,
        txn.merchant,
        txn.originalText,
        txn.budgetMonth,
        txn.categoryConfidence,
        txn.needsReview,
        txn.categorizedBy,
        txn.sourceType,
        txn.statementId,
        txn.cardIssuer,
        txn.cardLastFour,
        txn.cardHolder,
        txn.currency,
        txn.originalAmount,
        undefined, // isAnomaly
        undefined, // anomalyTypes
        undefined, // anomalyDetails
        undefined, // anomalyDismissed
      );
    }

    // Build anomaly details
    const anomalyDetails: Transaction['anomalyDetails'] = {};
    const anomalyTypes = anomalies.map((a) => a.type as typeof AnomalyType[keyof typeof AnomalyType]);

    for (const a of anomalies) {
      if (a.amountDeviation !== undefined) {
        anomalyDetails.amountDeviation = a.amountDeviation;
      }
      if (a.duplicateOf !== undefined) {
        anomalyDetails.duplicateOf = a.duplicateOf;
      }
      if (a.frequencyCount !== undefined) {
        anomalyDetails.frequencyCount = a.frequencyCount;
        anomalyDetails.frequencyPeriod = a.frequencyPeriod;
      }
    }

    return new TxnClass(
      txn.id,
      txn.date,
      txn.description,
      txn.amount,
      txn.type,
      txn.category,
      txn.balance,
      txn.merchant,
      txn.originalText,
      txn.budgetMonth,
      txn.categoryConfidence,
      txn.needsReview,
      txn.categorizedBy,
      txn.sourceType,
      txn.statementId,
      txn.cardIssuer,
      txn.cardLastFour,
      txn.cardHolder,
      txn.currency,
      txn.originalAmount,
      true, // isAnomaly
      anomalyTypes,
      anomalyDetails,
      txn.anomalyDismissed ?? false,
    );
  });
}
