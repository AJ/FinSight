// Transaction types
export interface Transaction {
  id: string;
  date: Date;
  description: string;
  amount: number; // Negative for expenses, positive for income
  category: string;
  type: "income" | "expense" | "transfer"; // Extended to include transfer
  balance?: number; // Running balance after this transaction
  merchant?: string;
  originalText?: string;
  budgetMonth?: string;
  // AI categorization fields
  categoryConfidence?: number; // 0-1, AI confidence score
  needsReview?: boolean; // True if medium/low confidence
  categorizedBy?: "keyword" | "ai" | "manual"; // How it was categorized
  // Credit card extension fields
  sourceType?: "bank" | "credit_card";
  statementId?: string;
  cardIssuer?: string;
  cardLastFour?: string;
  cardHolder?: string;
  currency?: string;
  originalAmount?: number;
  transactionType?: "purchase" | "payment" | "refund" | "interest" | "fee";
}

// Category types
export interface Category {
  id: string;
  name: string;
  icon?: string;
  keywords: string[];
  color?: string;
  type: "income" | "expense" | "both";
}

// Budget types
export interface Budget {
  id: string;
  month: string; // 'YYYY-MM' format
  totalIncome: number;
  allocations: BudgetAllocation[];
  createdAt: Date;
}

export interface BudgetAllocation {
  categoryId: string;
  categoryName: string;
  projectedAmount: number;
  budgetedAmount: number;
  actualAmount?: number;
}

// Settings types
export interface Currency {
  code: string;
  symbol: string;
  name: string;
}

export interface Settings {
  currency: Currency;
  dateFormat: string;
  theme: "light" | "dark";
}

// Chart data types
export interface ChartData {
  labels: string[];
  datasets: {
    label: string;
    data: number[];
    backgroundColor?: string | string[];
    borderColor?: string | string[];
    borderWidth?: number;
  }[];
}

// Budget progress types
export interface BudgetProgress {
  budgeted: number;
  spent: number;
  remaining: number;
  percentUsed: number;
  status: "on-track" | "warning" | "over-budget";
}

// File upload types
export type StatementFormat = "csv" | "pdf" | "xlsx" | "xls";

export interface ParsedStatement {
  transactions: Transaction[];
  format: StatementFormat;
  fileName: string;
  parseDate: Date;
}

// Chat types
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string; // ISO string
}

// LLM types
export interface LLMStatus {
  connected: boolean;
  models: string[];
  selectedModel: string | null;
}

export interface LLMParsedTransaction {
  date: string;
  description: string;
  amount: number;
  type: "income" | "expense";
}

export interface LLMParseResult {
  currency: {
    code: string;
    symbol: string;
    name: string;
  };
  transactions: LLMParsedTransaction[];
  model?: string;
}

// Re-export credit card types
export * from './creditCard';
