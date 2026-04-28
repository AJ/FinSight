// Re-export from class-based models
export {
  TransactionType,
  CategoryType,
  CategorizedBy,
  SourceType,
  AnomalyType,
  FrequencyPeriod,
  Category,
  Transaction,
} from '@/models';
export type { TransactionJSON, AnomalyDetails } from '@/models';

// Budget types
export interface BudgetPeriod {
  month: string;              // "YYYY-MM"
  income: number | null;      // manually set, carried forward, or null
  allocations: BudgetAllocation[];
  hiddenCategories: string[]; // category IDs hidden for this month
  createdAt: string;          // ISO timestamp
  updatedAt: string;          // ISO timestamp
}

export interface BudgetAllocation {
  categoryId: string;
  amount: number;             // the budgeted amount
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
  categoryId: string;
  budgeted: number;
  spent: number;
  remaining: number;
  percentUsed: number;
  status: 'on-track' | 'warning' | 'over-budget' | 'not-set';
}

// File upload types
export type StatementFormat = "csv" | "pdf" | "xlsx" | "xls";

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
  type: "credit" | "debit";
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
