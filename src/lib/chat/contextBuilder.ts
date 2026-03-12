import { format } from 'date-fns';
import { Currency, Transaction } from '@/types';

const DEFAULT_TOP_K = 10;
const DEFAULT_MAX_CONTEXT_CHARS = 3500;
const DESCRIPTION_PREVIEW_LEN = 56;
const COMMON_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'at', 'by', 'for', 'from', 'how', 'i', 'in', 'is',
  'it', 'me', 'my', 'of', 'on', 'or', 'the', 'to', 'was', 'what', 'when', 'where',
  'which', 'who', 'why', 'with', 'you', 'your',
]);

type ScoredTransaction = {
  txn: Transaction;
  score: number;
  timestamp: number;
};

export interface ChatContextOptions {
  topK?: number;
  maxChars?: number;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function formatDate(value: Date | string): string {
  const parsed = toDate(value);
  if (Number.isNaN(parsed.getTime())) return 'invalid-date';
  return format(parsed, 'yyyy-MM-dd');
}

function formatAmount(amount: number, currency: Currency): string {
  const abs = Math.abs(amount);
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.code,
      minimumFractionDigits: abs % 1 === 0 ? 0 : 2,
      maximumFractionDigits: abs % 1 === 0 ? 0 : 2,
    }).format(abs);
  } catch {
    return `${currency.symbol}${abs.toLocaleString('en-US')}`;
  }
}

function formatSignedAmount(amount: number, currency: Currency): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}${formatAmount(amount, currency)}`;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !COMMON_STOP_WORDS.has(token));
}

function parseQuestionNumbers(question: string): number[] {
  const rawNumbers = question.match(/\d[\d,]*(?:\.\d+)?/g) || [];
  return rawNumbers
    .map((value) => Number.parseFloat(value.replace(/,/g, '')))
    .filter((value) => Number.isFinite(value));
}

function scoreTransactions(transactions: Transaction[], question: string): ScoredTransaction[] {
  const tokens = tokenize(question);
  const numericValues = parseQuestionNumbers(question);
  const query = question.toLowerCase();

  return transactions.map((txn) => {
    const timestamp = toDate(txn.date).getTime();
    const description = txn.description.toLowerCase();
    const merchant = (txn.merchant || '').toLowerCase();
    const category = txn.category.id.toLowerCase();
    const searchable = `${description} ${merchant} ${category}`;

    let score = 0;

    for (const token of tokens) {
      if (searchable.includes(token)) score += 3;
      if (description.startsWith(token) || merchant.startsWith(token)) score += 1;
    }

    for (const value of numericValues) {
      if (Math.abs(Math.abs(txn.amount) - value) < 0.01) {
        score += 6;
      }
    }

    if ((query.includes('expense') || query.includes('spend')) && txn.isExpense) score += 1;
    if ((query.includes('income') || query.includes('earn')) && txn.isIncome) score += 1;
    if ((query.includes('credit') || query.includes('received')) && txn.isCredit) score += 1;
    if ((query.includes('debit') || query.includes('paid')) && txn.isDebit) score += 1;

    return { txn, score, timestamp };
  });
}

function getRelevantTransactions(transactions: Transaction[], question: string, topK: number): Transaction[] {
  if (transactions.length === 0 || topK <= 0) return [];

  const scored = scoreTransactions(transactions, question);
  const hasQuerySignal = scored.some((item) => item.score > 0);

  const sorted = scored.sort((a, b) => {
    if (hasQuerySignal && b.score !== a.score) return b.score - a.score;
    if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
    return Math.abs(b.txn.amount) - Math.abs(a.txn.amount);
  });

  return sorted.slice(0, topK).map((item) => item.txn);
}

function buildSummary(transactions: Transaction[], currency: Currency): string {
  const dates = transactions
    .map((txn) => toDate(txn.date))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());

  if (dates.length === 0) {
    return 'No valid transaction dates available.';
  }

  const income = transactions.filter((txn) => txn.isIncome).reduce((sum, txn) => sum + Math.abs(txn.amount), 0);
  const expenses = transactions.filter((txn) => txn.isExpense).reduce((sum, txn) => sum + Math.abs(txn.amount), 0);
  const excluded = transactions.filter((txn) => txn.isExcluded).reduce((sum, txn) => sum + Math.abs(txn.amount), 0);

  const expenseByCategory = new Map<string, number>();
  for (const txn of transactions) {
    if (!txn.isExpense) continue;
    const key = txn.category.id;
    expenseByCategory.set(key, (expenseByCategory.get(key) || 0) + Math.abs(txn.amount));
  }

  const totalExpenseForShare = Array.from(expenseByCategory.values()).reduce((a, b) => a + b, 0);
  const topCategories = Array.from(expenseByCategory.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category, total]) => {
      const share = totalExpenseForShare > 0 ? Math.round((total / totalExpenseForShare) * 100) : 0;
      return `${category} ${formatAmount(total, currency)} (${share}%)`;
    });

  const monthMap = new Map<string, { income: number; expense: number }>();
  for (const txn of transactions) {
    const month = format(toDate(txn.date), 'yyyy-MM');
    const existing = monthMap.get(month) || { income: 0, expense: 0 };
    if (txn.isIncome) existing.income += Math.abs(txn.amount);
    if (txn.isExpense) existing.expense += Math.abs(txn.amount);
    monthMap.set(month, existing);
  }

  const recentMonths = Array.from(monthMap.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 3)
    .map(([month, value]) => `${month}: in ${formatAmount(value.income, currency)}, out ${formatAmount(value.expense, currency)}`);

  return [
    `Transactions: ${transactions.length}`,
    `Period: ${formatDate(dates[0])} to ${formatDate(dates[dates.length - 1])}`,
    `Totals: income ${formatAmount(income, currency)}, expenses ${formatAmount(expenses, currency)}, excluded ${formatAmount(excluded, currency)}, net ${formatSignedAmount(income - expenses, currency)}`,
    `Top expense categories: ${topCategories.length > 0 ? topCategories.join('; ') : 'none'}`,
    `Recent months: ${recentMonths.length > 0 ? recentMonths.join(' | ') : 'none'}`,
  ].join('\n');
}

function buildContextText(summary: string, relevantLines: string[]): string {
  return [
    'Ledger snapshot (generated from CURRENT transaction store):',
    summary,
    '',
    `Relevant transactions for this question (top ${relevantLines.length}; sampled, not exhaustive):`,
    ...(relevantLines.length > 0 ? relevantLines : ['none']),
  ].join('\n');
}

export function buildChatContextForQuestion(
  transactions: Transaction[],
  currency: Currency,
  question: string,
  options?: ChatContextOptions
): string {
  if (transactions.length === 0) {
    return 'No transactions loaded.';
  }

  const topK = options?.topK ?? DEFAULT_TOP_K;
  const maxChars = options?.maxChars ?? DEFAULT_MAX_CONTEXT_CHARS;

  const summary = buildSummary(transactions, currency);
  const relevant = getRelevantTransactions(transactions, question, topK);
  const relevantLines = relevant.map((txn, index) => {
    const signedAmount = txn.isCredit ? Math.abs(txn.amount) : -Math.abs(txn.amount);
    const description = txn.description.length > DESCRIPTION_PREVIEW_LEN
      ? `${txn.description.slice(0, DESCRIPTION_PREVIEW_LEN)}...`
      : txn.description;

    return `${index + 1}. ${formatDate(txn.date)} | ${description} | ${formatSignedAmount(signedAmount, currency)} | ${txn.type} | ${txn.category.id}`;
  });

  let context = buildContextText(summary, relevantLines);

  while (context.length > maxChars && relevantLines.length > 3) {
    relevantLines.pop();
    context = buildContextText(summary, relevantLines);
  }

  if (context.length > maxChars) {
    context = `${context.slice(0, maxChars - 3)}...`;
  }

  return context;
}
