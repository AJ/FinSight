import { Transaction } from '@/types';

export type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export type RecurringStatus = 'active' | 'inactive' | 'paused';

export interface RecurringPayment {
  id: string;
  merchantName: string;           // Normalized display name
  originalMerchantNames: string[]; // All variants found
  category: string;               // entertainment, utilities, etc.
  amount: number;                 // Most recent amount
  averageAmount: number;          // Average across all occurrences
  frequency: Frequency;
  confidence: number;             // 0-1 score
  firstSeen: Date;
  lastSeen: Date;
  occurrenceCount: number;
  transactionIds: string[];       // Linked transactions
  isActive: boolean;              // Still appearing in recent period
  nextExpectedDate?: Date;        // Predicted next charge
  status: RecurringStatus;
}

export interface DetectionConfig {
  minOccurrences: number;           // Minimum transactions for weekly/monthly/quarterly
  minOccurrencesYearly: number;     // Allow single transaction for annual subscriptions
  amountVariance: number;           // 10% variance allowed (0.10)
  intervalTolerance: number;        // ±7 days for monthly
  inactiveAfterMissed: number;      // Flag inactive after 2 missed payments
  confidenceThreshold: number;      // Minimum confidence to include (0.7)
  excludeVariableAmounts: boolean;  // Skip subscriptions with >10% amount variance
}

export const DEFAULT_DETECTION_CONFIG: DetectionConfig = {
  minOccurrences: 2,
  minOccurrencesYearly: 1,
  amountVariance: 0.10,
  intervalTolerance: 7,
  inactiveAfterMissed: 2,
  confidenceThreshold: 0.7,
  excludeVariableAmounts: true,
};

export interface MerchantGroup {
  normalizedName: string;
  originalNames: string[];
  transactions: Transaction[];
}

export interface FrequencyAnalysis {
  frequency: Frequency | null;
  intervalVariance: number;
  avgInterval: number;
}

export interface ConfidenceResult {
  score: number;
  amountVariance: number;
  intervalVariance: number;
  occurrenceBonus: number;
}
