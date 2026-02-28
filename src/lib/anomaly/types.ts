/**
 * Anomaly Detection Types
 *
 * Types and configuration for the anomaly detection system.
 */

export type AnomalyType =
  | 'high_amount'        // Unusually high for category
  | 'low_amount'         // Unusually low (large refund/credit)
  | 'duplicate'          // Potential duplicate charge
  | 'unusual_frequency'; // Multiple charges to same merchant

import { FrequencyPeriod } from '@/models';

export interface AnomalyDetail {
  type: AnomalyType;
  amountDeviation?: number;  // Z-score for amount anomalies
  duplicateOf?: string;      // Transaction ID of potential duplicate
  frequencyCount?: number;   // Count of transactions in period
  frequencyPeriod?: FrequencyPeriod;
}

export interface CategoryStats {
  count: number;
  mean: number;
  stdDev: number;
}

export const ANOMALY_CONFIG = {
  // Amount anomalies
  amountStdDevThreshold: 2.5,       // Flag if > 2.5 std devs
  minTransactionsForStats: 5,       // Need 5+ in category for stats

  // Duplicates
  duplicateMerchantSimilarity: 0.8, // 80% string similarity
  duplicateWindowHours: 48,         // Within 48 hours

  // Frequency
  frequencyThreshold24h: 3,         // Max transactions to same merchant in 24h
  frequencyThreshold7d: 5,          // Max transactions to same merchant in 7d
} as const;

/**
 * Human-readable labels for anomaly types
 */
export const ANOMALY_LABELS: Record<AnomalyType, string> = {
  high_amount: 'unusually high amount',
  low_amount: 'unusually low amount',
  duplicate: 'potential duplicate',
  unusual_frequency: 'unusual frequency',
};
