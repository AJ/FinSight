import { Transaction } from '@/types';
import { v4 as uuidv4 } from 'uuid';
import {
  RecurringPayment,
  DetectionConfig,
  DEFAULT_DETECTION_CONFIG,
  MerchantGroup,
  Frequency,
  FrequencyAnalysis,
  ConfidenceResult,
} from './types';

// Common suffixes to remove when normalizing merchant names
const MERCHANT_SUFFIXES = [
  'pvt ltd', 'private limited', 'ltd', 'limited', 'inc', 'incorporated',
  'corp', 'corporation', 'co', 'company', 'llc', 'llp', 'gmbh',
  'subscription', 'payment', 'charge', 'billing', 'auto', 'recurring',
];

// Known subscription keywords to help identify recurring payments
const SUBSCRIPTION_KEYWORDS = [
  'netflix', 'spotify', 'amazon prime', 'youtube', 'google', 'apple',
  'microsoft', 'adobe', 'dropbox', 'zoom', 'slack', 'notion', 'canva',
  'gym', 'fitness', 'club', 'membership', 'subscription', 'monthly',
  'annual', 'yearly', 'weekly', 'insurance', 'utility', 'electric',
  'water', 'gas', 'internet', 'phone', 'mobile', 'broadband', 'dth',
  'hosting', 'domain', 'cloud', 'saas', 'patreon', 'github', 'gitlab',
];

/**
 * Normalize a merchant name for grouping
 * - Lowercase
 * - Remove special characters
 * - Remove common suffixes
 * - Trim whitespace
 */
export function normalizeMerchantName(name: string): string {
  if (!name) return '';

  let normalized = name.toLowerCase().trim();

  // Remove common prefixes like "payment to", "purchase at", etc.
  normalized = normalized.replace(/^(payment\s*(to|for)?|purchase\s*(at|from)?|bill\s*payment\s*(to)?|sub\s*)\s*/i, '');

  // Remove special characters except spaces
  normalized = normalized.replace(/[^a-z0-9\s]/g, ' ');

  // Remove common suffixes
  for (const suffix of MERCHANT_SUFFIXES) {
    const suffixRegex = new RegExp(`\\s+${suffix}\\s*$`, 'i');
    normalized = normalized.replace(suffixRegex, '');
  }

  // Collapse multiple spaces and trim
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

/**
 * Check if two normalized names likely refer to the same merchant
 */
export function merchantsMatch(name1: string, name2: string): boolean {
  const norm1 = normalizeMerchantName(name1);
  const norm2 = normalizeMerchantName(name2);

  if (!norm1 || !norm2) return false;

  // Exact match
  if (norm1 === norm2) return true;

  // One contains the other (handles "NETFLIX.COM" vs "NETFLIX")
  if (norm1.includes(norm2) || norm2.includes(norm1)) return true;

  // Check if first significant word matches (handles slight variations)
  const words1 = norm1.split(' ').filter(w => w.length > 2);
  const words2 = norm2.split(' ').filter(w => w.length > 2);

  if (words1.length > 0 && words2.length > 0) {
    if (words1[0] === words2[0]) {
      // First word matches - check if it's a significant word (not a common word)
      const commonWords = ['the', 'and', 'for', 'inc', 'ltd'];
      if (!commonWords.includes(words1[0])) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Group transactions by normalized merchant name
 */
export function groupTransactionsByMerchant(transactions: Transaction[]): MerchantGroup[] {
  const groups = new Map<string, MerchantGroup>();

  // Only consider expenses for recurring payments
  const expenses = transactions.filter(t => t.type === 'expense');

  for (const txn of expenses) {
    const merchantName = txn.merchant || txn.description;
    const normalized = normalizeMerchantName(merchantName);

    if (!normalized) continue;

    // Find existing group that matches
    let matchedKey: string | null = null;
    for (const key of groups.keys()) {
      if (merchantsMatch(normalized, key)) {
        matchedKey = key;
        break;
      }
    }

    if (matchedKey) {
      const group = groups.get(matchedKey)!;
      group.transactions.push(txn);
      if (!group.originalNames.includes(merchantName)) {
        group.originalNames.push(merchantName);
      }
    } else {
      groups.set(normalized, {
        normalizedName: normalized,
        originalNames: [merchantName],
        transactions: [txn],
      });
    }
  }

  return Array.from(groups.values());
}

/**
 * Calculate intervals (in days) between sorted transaction dates
 */
export function calculateIntervals(dates: Date[]): number[] {
  if (dates.length < 2) return [];

  const sortedDates = dates
    .map(d => d instanceof Date ? d : new Date(d))
    .sort((a, b) => a.getTime() - b.getTime());

  const intervals: number[] = [];
  for (let i = 1; i < sortedDates.length; i++) {
    const diffMs = sortedDates[i].getTime() - sortedDates[i - 1].getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays > 0) {
      intervals.push(diffDays);
    }
  }

  return intervals;
}

/**
 * Calculate standard deviation
 */
function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const squareDiffs = values.map(v => Math.pow(v - avg, 2));
  return Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / values.length);
}

/**
 * Detect frequency from intervals
 */
export function detectFrequency(intervals: number[], config: DetectionConfig): FrequencyAnalysis {
  if (intervals.length === 0) {
    return { frequency: null, intervalVariance: 1, avgInterval: 0 };
  }

  const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const variance = stdDev(intervals);

  // Define expected intervals (in days) with tolerances
  const frequencyPatterns: { freq: Frequency; expected: number; tolerance: number }[] = [
    { freq: 'weekly', expected: 7, tolerance: 2 },
    { freq: 'monthly', expected: 30, tolerance: config.intervalTolerance },
    { freq: 'quarterly', expected: 91, tolerance: 14 },
    { freq: 'yearly', expected: 365, tolerance: 30 },
  ];

  for (const pattern of frequencyPatterns) {
    if (Math.abs(avgInterval - pattern.expected) <= pattern.tolerance) {
      // Check if variance is acceptable (less than half the tolerance)
      if (variance <= pattern.tolerance * 1.5) {
        return {
          frequency: pattern.freq,
          intervalVariance: variance / pattern.expected, // Normalized variance
          avgInterval,
        };
      }
    }
  }

  return { frequency: null, intervalVariance: 1, avgInterval };
}

/**
 * Calculate confidence score for a recurring payment
 */
export function calculateConfidence(
  transactions: Transaction[],
  frequency: Frequency | null,
  intervals: number[],
  config: DetectionConfig
): ConfidenceResult {
  // Base confidence from occurrence count
  let occurrenceBonus = 0;
  const count = transactions.length;

  if (count >= 6) occurrenceBonus = 0.3;
  else if (count >= 4) occurrenceBonus = 0.2;
  else if (count >= 3) occurrenceBonus = 0.1;
  else if (count >= 2) occurrenceBonus = 0.05;

  // Amount consistency
  const amounts = transactions.map(t => Math.abs(t.amount));
  const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
  const amountVariance = avgAmount > 0 ? stdDev(amounts) / avgAmount : 1;

  // If amount variance is too high and we exclude variable amounts, confidence is 0
  if (config.excludeVariableAmounts && amountVariance > config.amountVariance) {
    return {
      score: 0,
      amountVariance,
      intervalVariance: 1,
      occurrenceBonus,
    };
  }

  // Interval consistency
  const { intervalVariance } = detectFrequency(intervals, config);

  // No frequency detected
  if (!frequency) {
    return {
      score: 0,
      amountVariance,
      intervalVariance,
      occurrenceBonus,
    };
  }

  // Calculate final score
  // Start with base score
  let score = 0.5;

  // Add occurrence bonus
  score += occurrenceBonus;

  // Adjust for amount consistency (max +0.2)
  if (amountVariance < 0.05) score += 0.2;
  else if (amountVariance < 0.10) score += 0.15;
  else if (amountVariance < config.amountVariance) score += 0.1;
  else score -= 0.1;

  // Adjust for interval consistency (max +0.2)
  if (intervalVariance < 0.1) score += 0.2;
  else if (intervalVariance < 0.2) score += 0.15;
  else if (intervalVariance < 0.3) score += 0.1;
  else score -= 0.1;

  // Bonus for known subscription keywords
  const merchantName = (transactions[0].merchant || transactions[0].description).toLowerCase();
  const hasKeyword = SUBSCRIPTION_KEYWORDS.some(kw => merchantName.includes(kw));
  if (hasKeyword) score += 0.1;

  // Clamp score between 0 and 1
  score = Math.max(0, Math.min(1, score));

  return {
    score,
    amountVariance,
    intervalVariance,
    occurrenceBonus,
  };
}

/**
 * Determine if a recurring payment is still active
 */
export function isActivePayment(
  lastSeen: Date,
  frequency: Frequency,
  config: DetectionConfig
): boolean {
  const now = new Date();
  const lastSeenDate = lastSeen instanceof Date ? lastSeen : new Date(lastSeen);

  // Expected interval in days
  const expectedDays: Record<Frequency, number> = {
    weekly: 7,
    monthly: 30,
    quarterly: 91,
    yearly: 365,
  };

  const expectedInterval = expectedDays[frequency] || 30;
  const gracePeriod = expectedInterval * config.inactiveAfterMissed;

  const daysSinceLastSeen = Math.round(
    (now.getTime() - lastSeenDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  return daysSinceLastSeen <= expectedInterval + gracePeriod;
}

/**
 * Predict next payment date
 */
export function predictNextDate(
  lastSeen: Date,
  frequency: Frequency
): Date {
  const lastSeenDate = lastSeen instanceof Date ? lastSeen : new Date(lastSeen);
  const nextDate = new Date(lastSeenDate);

  switch (frequency) {
    case 'weekly':
      nextDate.setDate(nextDate.getDate() + 7);
      break;
    case 'monthly':
      nextDate.setMonth(nextDate.getMonth() + 1);
      break;
    case 'quarterly':
      nextDate.setMonth(nextDate.getMonth() + 3);
      break;
    case 'yearly':
      nextDate.setFullYear(nextDate.getFullYear() + 1);
      break;
  }

  return nextDate;
}

/**
 * Choose the best display name from original merchant names
 */
function chooseDisplayName(originalNames: string[]): string {
  if (originalNames.length === 0) return 'Unknown Merchant';
  if (originalNames.length === 1) return originalNames[0];

  // Prefer the shortest name that's still meaningful (more than 3 chars)
  const sorted = [...originalNames].sort((a, b) => a.length - b.length);
  const meaningful = sorted.find(n => n.length > 3);
  return meaningful || sorted[0];
}

/**
 * Main detection function - analyzes transactions and returns recurring payments
 */
export function detectRecurringPayments(
  transactions: Transaction[],
  config: DetectionConfig = DEFAULT_DETECTION_CONFIG
): RecurringPayment[] {
  const recurringPayments: RecurringPayment[] = [];

  // Group transactions by merchant
  const merchantGroups = groupTransactionsByMerchant(transactions);

  for (const group of merchantGroups) {
    const { originalNames, transactions: groupTxns } = group;

    // Check minimum occurrences
    const minRequired = config.minOccurrences;

    if (groupTxns.length < minRequired) {
      // Special case: allow single transaction for yearly if it's a known subscription
      if (groupTxns.length < config.minOccurrencesYearly) {
        continue;
      }
    }

    // Calculate intervals
    const dates = groupTxns.map(t => t.date);
    const intervals = calculateIntervals(dates);

    // Detect frequency
    const { frequency } = detectFrequency(intervals, config);

    // Calculate confidence
    const confidenceResult = calculateConfidence(groupTxns, frequency, intervals, config);

    // Skip if below confidence threshold
    if (confidenceResult.score < config.confidenceThreshold) {
      continue;
    }

    // Skip if no frequency detected
    if (!frequency) {
      continue;
    }

    // Get amounts
    const amounts = groupTxns.map(t => Math.abs(t.amount));
    const latestAmount = amounts[amounts.length - 1];
    const averageAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;

    // Get dates
    const sortedDates = dates
      .map(d => d instanceof Date ? d : new Date(d))
      .sort((a, b) => a.getTime() - b.getTime());
    const firstSeen = sortedDates[0];
    const lastSeen = sortedDates[sortedDates.length - 1];

    // Determine if active
    const isActive = isActivePayment(lastSeen, frequency, config);

    // Predict next payment
    const nextExpectedDate = isActive ? predictNextDate(lastSeen, frequency) : undefined;

    // Determine status
    let status: 'active' | 'inactive' | 'paused';
    if (isActive) {
      status = 'active';
    } else {
      status = 'inactive';
    }

    // Get category from transactions
    const category = groupTxns[0].category || 'uncategorized';

    const recurringPayment: RecurringPayment = {
      id: uuidv4(),
      merchantName: chooseDisplayName(originalNames),
      originalMerchantNames: originalNames,
      category,
      amount: latestAmount,
      averageAmount,
      frequency,
      confidence: confidenceResult.score,
      firstSeen,
      lastSeen,
      occurrenceCount: groupTxns.length,
      transactionIds: groupTxns.map(t => t.id),
      isActive,
      nextExpectedDate,
      status,
    };

    recurringPayments.push(recurringPayment);
  }

  // Sort by amount (descending) and then by confidence
  return recurringPayments.sort((a, b) => {
    if (a.isActive !== b.isActive) {
      return a.isActive ? -1 : 1; // Active first
    }
    return b.amount - a.amount; // Higher amount first
  });
}

/**
 * Calculate monthly equivalent for a frequency
 */
export function getMonthlyAmount(amount: number, frequency: Frequency): number {
  switch (frequency) {
    case 'weekly':
      return amount * 4.33; // Average weeks per month
    case 'monthly':
      return amount;
    case 'quarterly':
      return amount / 3;
    case 'yearly':
      return amount / 12;
    default:
      return amount;
  }
}

/**
 * Get total monthly recurring amount from all active subscriptions
 */
export function getTotalMonthlyRecurring(payments: RecurringPayment[]): number {
  return payments
    .filter(p => p.isActive)
    .reduce((sum, p) => sum + getMonthlyAmount(p.amount, p.frequency), 0);
}
