/**
 * Credit Card Bill Analyzer - Type Definitions
 */

import { Currency } from '@/types';

// Statement type enumeration
export type StatementType = 'bank' | 'credit_card';

// Extended transaction type to include transfers
export type TransactionType = 'income' | 'expense' | 'transfer';

// Addon card information
export interface AddonCard {
  cardHolderName: string;
  cardLastFour?: string;
}

// Credit card statement metadata
export interface CreditCardStatement {
  id: string;
  fileName: string;
  parseDate: Date;
  cardLastFour: string;
  cardIssuer: string;
  cardHolder?: string;
  statementPeriod: {
    start: Date;
    end: Date;
  };
  statementDate: Date;
  paymentDueDate: Date;
  totalDue: number;
  minimumDue: number;
  creditLimit: number;
  availableCredit: number;
  previousBalance: number;
  paymentsReceived: number;
  purchasesAndCharges: number;
  interestCharged?: number;
  lateFee?: number;
  otherCharges?: number;
  addonCards?: AddonCard[];
  // Payment status (Feature 1)
  isPaid: boolean;
  paidDate?: Date;
  paidAmount?: number;
  // APR & Min Payment (Feature 2)
  apr?: number;
  monthlyInterestRate?: number;
  minimumPaymentPercent?: number;
  minimumPaymentFloor?: number;
  // Cashback (Feature 6)
  cashbackEarned?: number;
  // Reward Points (Feature 7)
  rewardPoints?: {
    openingBalance: number;
    earned: number;
    redeemed: number;
    expired: number;
    closingBalance: number;
    expiringNext?: number;
    expiringNextDate?: Date;
  };
}

// Extension fields for Transaction interface (to be merged)
export interface CCTransactionExtension {
  sourceType?: StatementType;
  statementId?: string;
  cardIssuer?: string;
  cardLastFour?: string;
  cardHolder?: string;
  localCurrency?: Currency;
  originalCurrency?: Currency;
  originalAmount?: number;
  isInternational?: boolean;
  transactionType?: 'purchase' | 'payment' | 'refund' | 'interest' | 'fee';
}

// Payment behavior metrics
export interface PaymentBehavior {
  fullPayRate: number;
  onTimeRate: number;
  totalInterestPaid: number;
  statementCount: number;
  period: {
    start: Date;
    end: Date;
  };
}

// Financial health score
export interface FinancialHealthScore {
  score: number;
  components: {
    utilization: { value: number; score: number };
    fullPayRate: { value: number; score: number };
    onTimeRate: { value: number; score: number };
    spendingTrend: { value: number; score: number };
  };
  calculatedAt: Date;
}

// LLM type detection result
export interface TypeDetectionResult {
  statementType: StatementType | 'unknown';
  confidence: number;
}

// CC extraction result from LLM
export interface CCExtractionResult {
  statement: {
    cardLastFour: string;
    cardIssuer: string;
    cardHolder?: string;
    statementPeriodStart: string;
    statementPeriodEnd: string;
    statementDate: string;
    paymentDueDate: string;
    totalDue: number;
    minimumDue: number;
    creditLimit: number;
    availableCredit: number;
    previousBalance: number;
    paymentsReceived: number;
    purchasesAndCharges: number;
    interestCharged?: number;
    lateFee?: number;
    otherCharges?: number;
    addonCards?: AddonCard[];
    // New extraction fields
    apr?: number;
    monthlyInterestRate?: number;
    minimumPaymentPercent?: number;
    minimumPaymentFloor?: number;
    cashbackEarned?: number;
    rewardPoints?: {
      openingBalance: number;
      earned: number;
      redeemed: number;
      expired: number;
      closingBalance: number;
      expiringNext?: number;
      expiringNextDate?: string;
    };
  };
  transactions: CCExtractedTransaction[];
}

// Transaction extracted from CC statement (LLM output format)
export interface CCExtractedTransaction {
  date: string;
  description: string;
  amount: number;
  localCurrency?: string;        // ISO code of card/local statement currency (e.g., "INR")
  originalCurrency?: string;     // Original ISO currency code for international transactions (e.g., "USD")
  originalAmount?: number;       // Amount in original currency
  isInternationalTransaction?: boolean;
  transactionType?: LLMTransactionType;
  cardHolder?: string;
}

/**
 * Transaction types as extracted by LLM from statements.
 * These represent the actual transaction type from the statement.
 * Applicable to both bank and credit card statements.
 */
export type LLMTransactionType = 
  // Money coming in (credits)
  | 'deposit'       // Cash/cheque deposit
  | 'transfer_in'   // Incoming transfer (NEFT/IMPS/UPI in)
  | 'refund'        // Merchant refund
  | 'interest'      // Interest credited (bank) / charged (CC)
  | 'cashback'      // Cashback earned
  | 'rewards'       // Points/miles redemption
  
  // Money going out (debits)
  | 'purchase'      // Regular purchase/charge
  | 'payment'       // Payment made (CC payment / bill payment)
  | 'withdrawal'    // ATM/cash withdrawal
  | 'transfer_out'  // Outgoing transfer (NEFT/IMPS/UPI out)
  | 'fee'           // Any fee (late, annual, forex, maintenance)
  | 'charge'        // General charge
  
  // Edge cases
  | 'adjustment'    // Billing adjustment/correction
  | 'reversal';     // Transaction reversal

// Due date item for display
export interface DueDateItem {
  cardIssuer: string;
  cardLastFour: string;
  dueDate: Date;
  totalDue: number;
  minimumDue: number;
  daysUntilDue: number;
  isOverdue: boolean;
}

// Utilization result
export interface UtilizationResult {
  perCard: Map<string, { issuer: string; lastFour: string; utilization: number; totalDue: number; creditLimit: number }>;
  aggregate: number;
  totalDue: number;
  totalLimit: number;
}

// Card comparison data
export interface CardComparison {
  cardIssuer: string;
  cardLastFour: string;
  cardLabel: string;
  totalSpend: number;
  transactionCount: number;
  utilization: number;
  categoryBreakdown: Record<string, number>;
}

// Dimensional analysis types
export type GroupingDimension = 'category' | 'card' | 'amountRange' | 'country' | 'cardHolder';

export interface GroupedSpending {
  key: string;
  label: string;
  amount: number;
  percentage: number;
  transactionCount: number;
}

export interface AnalysisFilters {
  cards?: string[]; // Filter by card identifiers
  categories?: string[];
  dateRange?: { start: Date; end: Date };
  amountRange?: { min: number; max: number };
}

// Period comparison types
export interface PeriodComparison {
  period1: { label: string; start: Date; end: Date };
  period2: { label: string; start: Date; end: Date };
  metrics: ComparisonMetric[];
}

export interface ComparisonMetric {
  name: string;
  value1: number;
  value2: number;
  change: number;
  changePercent: number;
  direction: 'up' | 'down' | 'same';
}

// ─────────────────────────────────────────────────────────────
// Feature 3: Interest Calculator Types
// ─────────────────────────────────────────────────────────────

export interface InterestProjection {
  cardIssuer: string;
  cardLastFour: string;
  currentBalance: number;
  apr: number;
  minimumDue: number;
  minimumPayoff: {
    monthsToPayoff: number;
    totalInterest: number;
    totalPaid: number;
  };
  fixedPaymentScenarios: {
    monthlyPayment: number;
    monthsToPayoff: number;
    totalInterest: number;
    totalPaid: number;
  }[];
  fullPaySavings: number;
}

// ─────────────────────────────────────────────────────────────
// Feature 4: Payment Strategy Types
// ─────────────────────────────────────────────────────────────

export type PaymentStrategy = 'avalanche' | 'snowball';

export interface CardPaymentRecommendation {
  cardIssuer: string;
  cardLastFour: string;
  balance: number;
  apr: number;
  recommendedPayment: number;
  priority: number;
  reason: string;
}

export interface PaymentRecommendation {
  strategy: PaymentStrategy;
  totalDebt: number;
  availableForPayment: number;
  cardPayments: CardPaymentRecommendation[];
  projectedSavings: number;
  debtFreeDate: Date;
}

// ─────────────────────────────────────────────────────────────
// Feature 5: Revolving Balance Detection Types
// ─────────────────────────────────────────────────────────────

export interface RevolvingBalanceStatus {
  cardIssuer: string;
  cardLastFour: string;
  isRevolving: boolean;
  paysMinimumOnly: boolean;
  balanceIncreasing: boolean;
  averageBalance: number;
  balanceTrend: number;
  consecutiveMonthsRevolving: number;
  riskLevel: 'none' | 'low' | 'medium' | 'high';
  warnings: string[];
}

export interface DebtTrapAnalysis {
  cards: RevolvingBalanceStatus[];
  totalRevolvingDebt: number;
  overallRiskLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  recommendations: string[];
}

// ─────────────────────────────────────────────────────────────
// Feature 6: Cashback Tracking Types
// ─────────────────────────────────────────────────────────────

export interface CashbackSummary {
  cardIssuer: string;
  cardLastFour: string;
  totalCashback: number;
  cashbackByPeriod: {
    period: string;
    cashback: number;
  }[];
  averageCashbackRate: number;
}

export interface CashbackAnalysis {
  totalCashbackAllCards: number;
  byCard: CashbackSummary[];
  bestCard: { issuer: string; lastFour: string; rate: number } | null;
}

// ─────────────────────────────────────────────────────────────
// Feature 7: Reward Points Tracking Types
// ─────────────────────────────────────────────────────────────

export interface RewardPointsSummary {
  cardIssuer: string;
  cardLastFour: string;
  currentBalance: number;
  totalEarned: number;
  totalRedeemed: number;
  totalExpired: number;
  earningRate: number;
  estimatedValue: number;
}

export interface RewardPointsAnalysis {
  totalPointsAllCards: number;
  estimatedTotalValue: number;
  byCard: RewardPointsSummary[];
  expiringSoon: {
    cardIssuer: string;
    cardLastFour: string;
    points: number;
    expiryDate: Date;
  }[];
}

