/**
 * Types for AI-powered spending insights.
 */

export type InsightType =
  | 'category_trend'
  | 'day_pattern'
  | 'merchant_insight'
  | 'anomaly'
  | 'budget_alert'
  | 'period_comparison'
  | 'savings_opportunity';

export type InsightSeverity = 'info' | 'warning' | 'positive';

export interface Insight {
  id: string;
  type: InsightType;
  title: string;
  description: string;
  severity: InsightSeverity;
  category?: string;
  data?: Record<string, unknown>;
}

export interface TransactionAnalytics {
  byMonth: Record<string, { income: number; expenses: number }>;
  byCategory: Record<string, { total: number; count: number; avg: number }>;
  byCategoryByMonth: Record<string, Record<string, number>>;
  byDayOfWeek: Record<number, { total: number; count: number }>;
  currentMonth: { income: number; expenses: number };
  previousMonth: { income: number; expenses: number };
  threeMonthAvg: { income: number; expenses: number };
  topMerchants: Array<{ name: string; total: number; count: number }>;
  topCategories: Array<{ category: string; total: number; percentage: number }>;
  anomalies: Array<{ description: string; amount: number; zScore: number }>;
  totalTransactions: number;
  dateRange: { start: string; end: string };
}

export interface InsightsGenerationOptions {
  provider: 'ollama' | 'lmstudio';
  baseUrl: string;
  model: string;
  currency: { code: string; symbol: string; name: string };
}
