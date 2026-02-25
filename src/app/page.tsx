'use client';

import { useMemo, useEffect, useState } from 'react';
import { useTransactionStore } from '@/lib/store/transactionStore';
import { useCategoryStore } from '@/lib/store/categoryStore';
import { useSettingsStore } from '@/lib/store/settingsStore';
import { useCreditCardStore } from '@/lib/store/creditCardStore';
import { Card, CardContent } from '@/components/ui/card';
import { StatCard } from '@/components/dashboard/StatCard';
import { CategoryPieChart } from '@/components/dashboard/CategoryPieChart';
import { TrendLineChart } from '@/components/dashboard/TrendLineChart';
import { FinancialHealthCard } from '@/components/dashboard/FinancialHealthCard';
import { InsightsPanel } from '@/components/insights/InsightsPanel';
import { RecurringPaymentsSummary } from '@/components/recurring/RecurringPaymentsSummary';
import { TrueBalanceWidget, CreditUtilizationCard, DueDatesList } from '@/components/creditCard';
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  CreditCard as CreditCardIcon,
  Upload,
  BarChart3,
  Sparkles,
  PiggyBank,
} from 'lucide-react';
import { format } from 'date-fns';
import { useUpload } from '@/components/layout/UploadContext';
import { checkLLMStatus } from '@/lib/parsers/llmParser';
import { toast } from 'sonner';

// Currency symbol icon component
function CurrencySymbol({ symbol }: { symbol: string }) {
  return (
    <span className="w-5 h-5 flex items-center justify-center text-lg font-bold">
      {symbol}
    </span>
  );
}

export default function DashboardPage() {
  const transactions = useTransactionStore((state) => state.transactions);
  const categories = useCategoryStore((state) => state.categories);
  const currency = useSettingsStore((state) => state.currency);
  const initializeDefaultCategories = useCategoryStore((state) => state.initializeDefaultCategories);

  // Credit card store
  const getAllUniqueCards = useCreditCardStore((state) => state.getAllUniqueCards);
  const hasCCData = getAllUniqueCards().length > 0;

  // Upload context
  const { openUpload } = useUpload();

  useEffect(() => {
    initializeDefaultCategories();
  }, [initializeDefaultCategories]);

  // Check LLM connection and show toast if offline (only once)
  const [hasCheckedLLM, setHasCheckedLLM] = useState(false);

  useEffect(() => {
    if (hasCheckedLLM) return;

    const checkConnection = async () => {
      try {
        const status = await checkLLMStatus();
        if (!status.connected) {
          toast.error('AI is offline', {
            description: 'Connect Ollama or LM Studio to parse statements. Go to Settings to configure.',
            action: {
              label: 'Settings',
              onClick: () => window.location.href = '/settings',
            },
          });
        }
      } catch {
        toast.error('AI is offline', {
          description: 'Connect Ollama or LM Studio to parse statements. Go to Settings to configure.',
          action: {
            label: 'Settings',
            onClick: () => window.location.href = '/settings',
          },
        });
      }
      setHasCheckedLLM(true);
    };

    // Delay check slightly to avoid race conditions
    const timer = setTimeout(checkConnection, 500);
    return () => clearTimeout(timer);
  }, [hasCheckedLLM]);

  // Calculate stats
  const stats = useMemo(() => {
    if (transactions.length === 0) {
      return { income: 0, expenses: 0, balance: 0, savingsRate: '0', period: 'No data' };
    }

    const income = transactions
      .filter((t) => t.type === 'income')
      .reduce((sum, t) => sum + t.amount, 0);

    const expenses = transactions
      .filter((t) => t.type === 'expense')
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);

    const balance = income - expenses;
    const savingsRate = income > 0 ? ((balance / income) * 100).toFixed(1) : '0';

    const dates = transactions
      .map(t => (t.date instanceof Date ? t.date : new Date(t.date)))
      .filter(d => !isNaN(d.getTime()))
      .sort((a, b) => a.getTime() - b.getTime());
    const firstDate = dates[0];
    const lastDate = dates[dates.length - 1];
    const period = firstDate && lastDate
      ? `${format(firstDate, 'MMM yyyy')} - ${format(lastDate, 'MMM yyyy')}`
      : 'All time';

    return { income, expenses, balance, savingsRate, period };
  }, [transactions]);

  // Empty state
  if (transactions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          {/* Icon */}
          <div className="w-20 h-20 mx-auto mb-6 rounded-xl bg-primary flex items-center justify-center">
            <BarChart3 className="w-10 h-10 text-white" />
          </div>

          {/* Title */}
          <h2 className="text-2xl font-bold text-foreground mb-3">
            Welcome to FinSight
          </h2>
          <p className="text-muted-foreground mb-8">
            Upload a bank statement to discover spending patterns, track subscriptions,
            and get personalized insights about your finances.
          </p>

          {/* CTA */}
          <button
            onClick={openUpload}
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
          >
            <Upload className="w-4 h-4" />
            Upload Statement
          </button>

          {/* Features */}
          <div className="grid grid-cols-3 gap-4 mt-10">
            <div className="text-center">
              <div className="w-10 h-10 mx-auto mb-2 rounded-lg bg-primary/15 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-primary" />
              </div>
              <p className="text-xs text-muted-foreground">Spending Trends</p>
            </div>
            <div className="text-center">
              <div className="w-10 h-10 mx-auto mb-2 rounded-lg bg-primary/15 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-primary" />
              </div>
              <p className="text-xs text-muted-foreground">Smart Detection</p>
            </div>
            <div className="text-center">
              <div className="w-10 h-10 mx-auto mb-2 rounded-lg bg-primary/15 flex items-center justify-center">
                <PiggyBank className="w-5 h-5 text-primary" />
              </div>
              <p className="text-xs text-muted-foreground">AI Insights</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Dashboard with data
  return (
    <div className="flex-1 overflow-y-auto">
      {/* Page Header */}
      <div className="border-b border-border bg-card">
        <div className="px-6 py-4">
          <h1 className="text-xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {transactions.length} transactions • {stats.period}
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="p-6 space-y-6">
        {/* Financial Health Card */}
        <FinancialHealthCard />

        {/* Stats Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Total Income"
            value={stats.income}
            icon={<TrendingUp className="w-5 h-5" />}
            trend="positive"
          />
          <StatCard
            title="Total Expenses"
            value={stats.expenses}
            icon={<TrendingDown className="w-5 h-5" />}
            trend="negative"
          />
          <StatCard
            title="Net Balance"
            value={stats.balance}
            icon={<Wallet className="w-5 h-5" />}
            trend={stats.balance >= 0 ? 'positive' : 'negative'}
          />
          <StatCard
            title="Savings Rate"
            value={`${stats.savingsRate}%`}
            icon={<CurrencySymbol symbol={currency.symbol} />}
            trend="neutral"
            isPercentage
          />
        </div>

        {/* Charts */}
        <div className="grid lg:grid-cols-2 gap-6">
          <CategoryPieChart
            transactions={transactions}
            categories={categories}
          />
          <TrendLineChart transactions={transactions} />
        </div>

        {/* Credit Card Widgets */}
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <CreditCardIcon className="w-5 h-5" />
            Credit Cards
          </h2>

          {hasCCData ? (
            <div className="grid md:grid-cols-3 gap-4">
              <TrueBalanceWidget />
              <CreditUtilizationCard />
              <DueDatesList />
            </div>
          ) : (
            <Card className="border-dashed border-border">
              <CardContent className="py-8 text-center">
                <CreditCardIcon className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                <p className="text-muted-foreground mb-4">
                  Upload a credit card statement to see utilization and due dates.
                </p>
                <button
                  onClick={openUpload}
                  className="inline-flex items-center gap-2 text-primary hover:underline"
                >
                  <Upload className="w-4 h-4" />
                  Upload Statement
                </button>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Recurring Payments Summary */}
        <RecurringPaymentsSummary />

        {/* AI Insights */}
        <InsightsPanel />
      </div>
    </div>
  );
}
