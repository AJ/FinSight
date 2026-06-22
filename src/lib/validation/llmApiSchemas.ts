/**
 * Request/Response validation schemas for LLM API endpoints.
 * Uses Zod for runtime validation with clear error messages.
 */

import { z } from 'zod';
import { PROVIDERS } from '@/lib/llm/types';

// ─────────────────────────────────────────────────────────────
// Categorize Endpoint
// ─────────────────────────────────────────────────────────────

export const CategorizeTransactionSchema = z.object({
  id: z.string().min(1, 'Transaction ID is required'),
  description: z.string().default(''),
  merchant: z.string().optional(),
  amount: z.number().or(z.string()).transform(val => {
    const num = typeof val === 'string' ? parseFloat(val) : val;
    if (isNaN(num)) throw new Error('Amount must be a valid number');
    return num;
  }),
  type: z.enum(['credit', 'debit', 'income', 'expense', 'transfer'])
    .transform(type => {
      // Normalize to credit/debit
      if (type === 'income') return 'credit';
      if (type === 'expense') return 'debit';
      return type;
    }),
  sourceType: z.enum(['bank', 'credit_card']).optional(),
  transactionSubType: z.string().optional(),
  categoryId: z.string().optional(),
});

export const CategorizeRequestSchema = z.object({
  transactions: z.array(CategorizeTransactionSchema)
    .min(1, 'At least one transaction is required'),
  provider: z.enum(['ollama', 'lmstudio']).optional().default('ollama'),
  baseUrl: z.string().url('Invalid base URL').optional().default(PROVIDERS.ollama.defaultUrl),
  model: z.string().min(1, 'Model name is required').optional(),
});

export const CategorizeResponseSchema = z.object({
  results: z.array(z.object({
    id: z.string(),
    category: z.string(),
    confidence: z.number().min(0).max(1),
    source: z.enum(['rule', 'ai', 'keyword']),
  })),
});

// ─────────────────────────────────────────────────────────────
// Insights Endpoint
// ─────────────────────────────────────────────────────────────

export const TransactionAnalyticsSchema = z.object({
  totalTransactions: z.number().int().nonnegative().optional().default(0),
  dateRange: z.object({
    start: z.string(),
    end: z.string(),
  }).optional(),
  currentMonth: z.object({
    income: z.number().default(0),
    expenses: z.number().default(0),
  }).optional(),
  previousMonth: z.object({
    income: z.number().default(0),
    expenses: z.number().default(0),
  }).optional(),
  threeMonthAvg: z.object({
    income: z.number().default(0),
    expenses: z.number().default(0),
  }).optional(),
  byCategory: z.record(z.string(), z.object({
    total: z.number().default(0),
    count: z.number().int().nonnegative().default(0),
  })).optional(),
  topCategories: z.array(z.object({
    category: z.string(),
    total: z.number(),
    percentage: z.number(),
  })).optional(),
  topMerchants: z.array(z.object({
    name: z.string(),
    total: z.number(),
    count: z.number().int().nonnegative(),
  })).optional(),
  byDayOfWeek: z.record(z.string(), z.object({
    total: z.number().default(0),
    count: z.number().int().nonnegative().default(0),
  })).optional(),
  byMonth: z.record(z.string(), z.object({
    income: z.number().default(0),
    expenses: z.number().default(0),
  })).optional(),
  byCategoryByMonth: z.record(z.string(), z.record(z.string(), z.number())).optional(),
  anomalies: z.array(z.object({
    description: z.string(),
    amount: z.number(),
    zScore: z.number().optional(),
  })).optional(),
});

export const InsightsRequestSchema = z.object({
  analytics: TransactionAnalyticsSchema,
  provider: z.enum(['ollama', 'lmstudio']).optional().default('ollama'),
  baseUrl: z.string().url('Invalid base URL').optional().default(PROVIDERS.ollama.defaultUrl),
  model: z.string().min(1, 'Model name is required').optional(),
  currency: z.object({
    code: z.string().length(3, 'Currency code must be 3 characters'),
    symbol: z.string(),
    name: z.string(),
  }), // Required - no default, user's settings currency must be provided
});

export const InsightSchema = z.object({
  type: z.enum([
    'category_trend',
    'day_pattern',
    'merchant_insight',
    'anomaly',
    'budget_alert',
    'period_comparison',
    'savings_opportunity',
  ]),
  title: z.string().max(100, 'Title must be less than 100 characters'),
  description: z.string().max(500, 'Description must be less than 500 characters'),
  severity: z.enum(['info', 'warning', 'positive']),
  category: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export const InsightsResponseSchema = z.object({
  insights: z.array(InsightSchema),
});

// ─────────────────────────────────────────────────────────────
// Type Helpers
// ─────────────────────────────────────────────────────────────

export type CategorizeRequest = z.infer<typeof CategorizeRequestSchema>;
export type CategorizeResponse = z.infer<typeof CategorizeResponseSchema>;
export type InsightsRequest = z.infer<typeof InsightsRequestSchema>;
export type InsightsResponse = z.infer<typeof InsightsResponseSchema>;
