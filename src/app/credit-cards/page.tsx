"use client";

import { useMemo, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CreditCard, Upload } from "lucide-react";
import { useCreditCardStore } from "@/lib/store/creditCardStore";
import { useTransactionStore } from "@/lib/store/transactionStore";
import { useUpload } from "@/components/layout/UploadContext";
import {
  TrueBalanceWidget,
  DueDatesList,
  FinancialHealthScoreCard,
  PaymentBehaviorCard,
  // New components
  StatementHistoryCard,
  InterestCalculatorCard,
  PaymentStrategyCard,
  DebtTrapWarningCard,
  CashbackSummaryCard,
  RewardPointsCard,
  // Card display
  CreditCardsGrid,
  // Tabs
  SpendingTab,
} from "@/components/creditCard";

export default function CreditCardsPage() {
  const { openUpload } = useUpload();
  const getAllUniqueCards = useCreditCardStore((state) => state.getAllUniqueCards);
  const transactions = useTransactionStore((state) => state.transactions);

  // Hydration-safe client gate without effect-driven setState.
  const isHydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  const uniqueCards = useMemo(() => getAllUniqueCards(), [getAllUniqueCards]);
  const hasCCData = uniqueCards.length > 0;

  // Count CC transactions
  const ccTransactionCount = useMemo(() => {
    return transactions.filter((t) => t.sourceType === "credit_card").length;
  }, [transactions]);

  // Wait for hydration to prevent SSR mismatch
  if (!isHydrated) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="border-b border-border bg-card">
          <div className="px-6 py-4">
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <CreditCard className="w-5 h-5" />
              Credit Cards
            </h1>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Page Header */}
      <div className="border-b border-border bg-card">
        <div className="px-6 py-4">
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <CreditCard className="w-5 h-5" />
            Credit Cards
          </h1>
          <p className="text-sm text-muted-foreground">
            {hasCCData ? (
              <>
                {uniqueCards.length} card{uniqueCards.length > 1 ? "s" : ""} tracked •{" "}
                {ccTransactionCount} transactions
              </>
            ) : (
              "Upload a credit card statement to get started"
            )}
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="p-6">
        {!hasCCData ? (
          /* Empty State */
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <CreditCard className="w-16 h-16 text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">No Credit Card Data</h2>
            <p className="text-muted-foreground mb-6 max-w-md">
              Upload a credit card statement (PDF) to see your utilization,
              payment due dates, and spending analytics.
            </p>
            <Button onClick={openUpload}>
              <Upload className="w-4 h-4 mr-2" />
              Upload Statement
            </Button>
          </div>
        ) : (
          <>
            {/* KPI Row - 3 compact cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <TrueBalanceWidget variant="total" compact />
              <DueDatesList compact />
              <FinancialHealthScoreCard compact />
            </div>

            {/* Your Cards - Section Label */}
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Your Cards
            </div>

            {/* Cards Grid */}
            <div className="mb-6">
              <CreditCardsGrid />
            </div>

            {/* Tabbed Content */}
            <Tabs defaultValue="spending" className="space-y-6">
              <TabsList className="grid w-full grid-cols-5 lg:w-auto lg:inline-grid">
                <TabsTrigger value="spending">Spending</TabsTrigger>
                <TabsTrigger value="behavior">Payment Behavior</TabsTrigger>
                <TabsTrigger value="insights">AI Insights</TabsTrigger>
                <TabsTrigger value="strategy">Payment Strategy</TabsTrigger>
                <TabsTrigger value="rewards">Rewards & Fees</TabsTrigger>
              </TabsList>

              <TabsContent value="spending" className="space-y-6">
                <SpendingTab />
              </TabsContent>

              <TabsContent value="behavior" className="space-y-6">
                <FinancialHealthScoreCard />
                <PaymentBehaviorCard />
              </TabsContent>

              <TabsContent value="insights" className="space-y-6">
                <DebtTrapWarningCard />
              </TabsContent>

              <TabsContent value="strategy" className="space-y-6">
                <InterestCalculatorCard />
                <PaymentStrategyCard />
                <StatementHistoryCard />
              </TabsContent>

              <TabsContent value="rewards" className="space-y-6">
                <CashbackSummaryCard />
                <RewardPointsCard />
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </div>
  );
}

