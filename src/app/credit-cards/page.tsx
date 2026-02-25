"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CreditCard, Upload } from "lucide-react";
import { useCreditCardStore } from "@/lib/store/creditCardStore";
import { useTransactionStore } from "@/lib/store/transactionStore";
import { useUpload } from "@/components/layout/UploadContext";
import {
  TrueBalanceWidget,
  CreditUtilizationCard,
  DueDatesList,
  CardComparisonTable,
  FinancialHealthScoreCard,
  PaymentBehaviorCard,
  InternationalSpendingCard,
  DimensionalAnalysisView,
  PeriodComparisonView,
} from "@/components/creditCard";

export default function CreditCardsPage() {
  const { openUpload } = useUpload();
  const getAllUniqueCards = useCreditCardStore((state) => state.getAllUniqueCards);
  const transactions = useTransactionStore((state) => state.transactions);

  const uniqueCards = useMemo(() => getAllUniqueCards(), [getAllUniqueCards]);
  const hasCCData = uniqueCards.length > 0;

  // Count CC transactions
  const ccTransactionCount = useMemo(() => {
    return transactions.filter((t) => t.sourceType === "credit_card").length;
  }, [transactions]);

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
            {/* Summary Widgets */}
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              <TrueBalanceWidget />
              <FinancialHealthScoreCard />
              <CreditUtilizationCard />
              <DueDatesList />
            </div>

            {/* Tabbed Content */}
            <Tabs defaultValue="comparison" className="space-y-6">
              <TabsList className="grid w-full grid-cols-4 lg:w-auto lg:inline-grid">
                <TabsTrigger value="comparison">Card Comparison</TabsTrigger>
                <TabsTrigger value="analysis">Spending Analysis</TabsTrigger>
                <TabsTrigger value="behavior">Payment Behavior</TabsTrigger>
                <TabsTrigger value="period">Period Comparison</TabsTrigger>
              </TabsList>

              <TabsContent value="comparison" className="space-y-6">
                <CardComparisonTable />
                <InternationalSpendingCard />
              </TabsContent>

              <TabsContent value="analysis" className="space-y-6">
                <DimensionalAnalysisView />
              </TabsContent>

              <TabsContent value="behavior" className="space-y-6">
                <PaymentBehaviorCard />
              </TabsContent>

              <TabsContent value="period" className="space-y-6">
                <PeriodComparisonView />
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </div>
  );
}
