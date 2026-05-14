'use client';

import { useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useTransactionStore } from '@/lib/store/transactionStore';
import { useSettingsStore } from '@/lib/store/settingsStore';
import { useInsightsStore } from '@/lib/store/insightsStore';
import { getTransactionAnalytics } from '@/lib/insights';
import { InsightCard } from './InsightCard';
import { Sparkles, RefreshCw, AlertCircle, Loader2 } from 'lucide-react';
import { generateInsights } from '@/lib/insights/browserGenerator';
import { debugLog } from '@/lib/utils/debug';

export function InsightsPanel() {
  const transactions = useTransactionStore((state) => state.transactions);
  const { llmProvider, llmServerUrl, llmModel, currency } = useSettingsStore();
  const { insights, isGenerating, error, setGenerating, setInsights, setError, clear } =
    useInsightsStore();

  // Pre-compute analytics for cache key comparison
  const analytics = useMemo(() => getTransactionAnalytics(transactions), [transactions]);

  const handleGenerate = useCallback(async () => {
    if (!llmModel) {
      setError('Please select an AI model in Settings first.');
      return;
    }

    if (transactions.length === 0) {
      setError('No transactions to analyze.');
      return;
    }

    setGenerating(true);

    try {
      debugLog("InsightsPanel", "Starting insight generation with transaction count", transactions.length," transactions:", transactions);

      const insightsWithIds = await generateInsights({
        analytics,
        currency,
        provider: llmProvider,
        baseUrl: llmServerUrl,
        model: llmModel ?? undefined,
      });

      if (!insightsWithIds || insightsWithIds.length === 0) {
        setError('The AI could not generate insights from your data. Try again.');
        return;
      }

      debugLog("InsightsPanel", "Generated insights:", insightsWithIds);
      setInsights(insightsWithIds);
    } catch (err) {
      debugLog("InsightsPanel", "Error generating insights:", err);
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to generate insights. Check your AI connection.'
      );
    }
  }, [analytics, llmModel, llmProvider, llmServerUrl, currency, transactions, setError, setGenerating, setInsights]);

  const handleRetry = useCallback(() => {
    clear();
    handleGenerate();
  }, [clear, handleGenerate]);

  // Empty state - show generate button
  if (insights.length === 0 && !isGenerating && !error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5" />
            AI Spending Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-muted-foreground mb-4">
              Generate AI-powered insights from your spending patterns
            </p>
            <Button onClick={handleGenerate} disabled={transactions.length === 0}>
              <Sparkles className="w-4 h-4 mr-2" />
              Generate Insights
            </Button>
            {transactions.length === 0 && (
              <p className="text-sm text-muted-foreground mt-2">
                Import transactions first to generate insights
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Loading state
  if (isGenerating) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5" />
            AI Spending Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">Analyzing your spending patterns...</p>
          </div>
          {/* Skeleton cards */}
          <div className="space-y-3 mt-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-20 bg-muted/50 rounded-lg animate-pulse"
              />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5" />
            AI Spending Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <AlertCircle className="w-8 h-8 mx-auto mb-4 text-destructive" />
            <p className="text-destructive mb-4">{error}</p>
            <Button variant="outline" onClick={handleRetry}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Try Again
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Success state - show insights
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="w-5 h-5" />
          AI Spending Insights
        </CardTitle>
        <Button variant="outline" size="sm" onClick={handleRetry}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Regenerate
        </Button>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {insights.map((insight, index) => (
            <InsightCard key={insight.id} insight={insight} index={index} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
