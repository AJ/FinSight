/**
 * Credit Card Bill Analyzer - Type Definitions
 */

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
}

// Extension fields for Transaction interface (to be merged)
export interface CCTransactionExtension {
  sourceType?: StatementType;
  statementId?: string;
  cardIssuer?: string;
  cardLastFour?: string;
  cardHolder?: string;
  currency?: string;
  originalAmount?: number;
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
  };
  transactions: CCExtractedTransaction[];
}

// Transaction extracted from CC statement
export interface CCExtractedTransaction {
  date: string;
  description: string;
  amount: number;
  currency?: string;
  originalAmount?: number;
  transactionType?: 'purchase' | 'payment' | 'refund' | 'interest' | 'fee';
  cardHolder?: string;
}

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
