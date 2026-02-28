"use client";

export const dynamic = "force-dynamic";

import { useState, useMemo, useCallback, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useTransactionStore } from "@/lib/store/transactionStore";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Search,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  Loader2,
  CreditCard,
  SlidersHorizontal,
  X,
  Undo2,
} from "lucide-react";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/currencyFormatter";
import { getCategoryDisplay } from "@/components/transactions/CategoryBadge";
import { InlineCategoryEditor } from "@/components/transactions/InlineCategoryEditor";
import { DEFAULT_CATEGORIES } from "@/lib/categorization/categories";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ANOMALY_LABELS } from "@/lib/anomaly";
import { CategorizedBy } from "@/types";

function TransactionsPageContent() {
  const searchParams = useSearchParams();
  const transactions = useTransactionStore((state) => state.transactions);
  const selectedIds = useTransactionStore((state) => state.selectedIds);
  const toggleSelection = useTransactionStore((state) => state.toggleSelection);
  const clearSelection = useTransactionStore((state) => state.clearSelection);
  const updateCategory = useTransactionStore((state) => state.updateCategory);
  const getTransactionsNeedingReview = useTransactionStore((state) => state.getTransactionsNeedingReview);
  const dismissAnomaly = useTransactionStore((state) => state.dismissAnomaly);
  const restoreAnomaly = useTransactionStore((state) => state.restoreAnomaly);

  const currency = useSettingsStore((state) => state.currency);
  const llmProvider = useSettingsStore((state) => state.llmProvider);
  const ollamaUrl = useSettingsStore((state) => state.ollamaUrl);
  const llmModel = useSettingsStore((state) => state.llmModel);

  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterAnomaly, setFilterAnomaly] = useState<boolean>(
    searchParams.get("anomaly") === "true"
  );
  const [filterNeedsReview, setFilterNeedsReview] = useState<boolean>(false);
  const [isCategorizing, setIsCategorizing] = useState(false);

  // Sync filter with URL params
  useEffect(() => {
    if (searchParams.get("anomaly") === "true" && !filterAnomaly) {
      setFilterAnomaly(true);
    }
  }, [searchParams, filterAnomaly]);

  const filteredTransactions = useMemo(() => {
    return transactions
      .filter((t) => {
        const matchesSearch = t.description
          .toLowerCase()
          .includes(searchTerm.toLowerCase());
        const matchesCategory =
          filterCategory === "all" || t.category.id === filterCategory;
        const matchesType = filterType === "all" || t.type === filterType;
        const matchesAnomaly =
          !filterAnomaly || (t.isAnomaly && !t.anomalyDismissed);
        const matchesNeedsReview = !filterNeedsReview || t.needsReview;

        return matchesSearch && matchesCategory && matchesType && matchesAnomaly && matchesNeedsReview;
      })
      .sort((a, b) => {
        const dateA = a.date instanceof Date ? a.date : new Date(a.date);
        const dateB = b.date instanceof Date ? b.date : new Date(b.date);
        return dateB.getTime() - dateA.getTime();
      });
  }, [transactions, searchTerm, filterCategory, filterType, filterAnomaly, filterNeedsReview]);

  // Count active anomalies
  const activeAnomalyCount = useMemo(() => {
    return transactions.filter((t) => t.isAnomaly && !t.anomalyDismissed).length;
  }, [transactions]);

  // Auto-clear anomaly filter when no anomalies remain
  useEffect(() => {
    if (filterAnomaly && activeAnomalyCount === 0) {
      setFilterAnomaly(false);
    }
  }, [filterAnomaly, activeAnomalyCount]);

  const needsReviewCount = getTransactionsNeedingReview().length;
  const selectedCount = selectedIds.length;
  const isAllSelected = filteredTransactions.length > 0 &&
    filteredTransactions.every((t) => selectedIds.includes(t.id));

  const handleSelectAll = useCallback(() => {
    if (isAllSelected) {
      clearSelection();
    } else {
      const filteredIds = filteredTransactions.map((t) => t.id);
      useTransactionStore.getState().setSelectedIds(filteredIds);
    }
  }, [isAllSelected, clearSelection, filteredTransactions]);

  const handleCategoryChange = (transactionId: string, newCategory: string) => {
    updateCategory(transactionId, newCategory, CategorizedBy.Manual);
    toast.success("Category updated");
  };

  const runCategorization = async (txns: typeof transactions) => {
    if (txns.length === 0) return;

    setIsCategorizing(true);
    const toastId = toast.loading(`Categorizing ${txns.length} transactions...`);

    try {
      const response = await fetch("/api/categorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactions: txns.map((t) => ({
            id: t.id,
            description: t.description,
            amount: t.amount,
            type: t.type,
          })),
          provider: llmProvider,
          baseUrl: ollamaUrl,
          model: llmModel,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Categorization failed");
      }

      const data = await response.json();
      const results = data.results || [];

      let reviewCount = 0;
      for (const result of results) {
        const needsReview = result.confidence < 0.85;
        if (needsReview) reviewCount++;
        useTransactionStore.getState().updateTransaction(result.id, {
          category: result.category,
          categoryConfidence: result.confidence,
          needsReview,
          categorizedBy: result.confidence >= 0.3 ? CategorizedBy.AI : CategorizedBy.Keyword,
        });
      }

      toast.success("Categorization complete", {
        id: toastId,
        description: `${results.length} categorized. ${reviewCount} need review.`
      });
    } catch (error) {
      console.error("[Categorize]", error);
      toast.error("Categorization failed", {
        id: toastId,
        description: error instanceof Error ? error.message : "Please try again"
      });
    } finally {
      setIsCategorizing(false);
      clearSelection();
    }
  };

  const handleCategorizeAll = () => runCategorization(transactions);
  const handleCategorizeSelected = () => {
    const selected = transactions.filter((t) => selectedIds.includes(t.id));
    runCategorization(selected);
  };
  const handleCategorizeNeedsReview = () => {
    runCategorization(getTransactionsNeedingReview());
  };

  const hasFilters = searchTerm || filterCategory !== "all" || filterType !== "all" || filterAnomaly || filterNeedsReview;

  const clearFilters = () => {
    setSearchTerm("");
    setFilterCategory("all");
    setFilterType("all");
    setFilterAnomaly(false);
    setFilterNeedsReview(false);
  };

  return (
    <div className="flex-1 overflow-y-auto flex flex-col">
      {/* Page Header */}
      <div className="border-b border-border bg-card shrink-0">
        <div className="px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Transactions</h1>
            <p className="text-sm text-muted-foreground">
              {transactions.length} transactions
              {needsReviewCount > 0 && (
                <span className="text-amber-500 ml-2">
                  {needsReviewCount} need review
                </span>
              )}
            </p>
          </div>

          {/* Primary Actions */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCategorizeAll}
              disabled={isCategorizing || transactions.length === 0}
            >
              {isCategorizing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Reprocess All
            </Button>
          </div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="border-b border-border bg-muted/30 shrink-0">
        <div className="px-6 py-3 flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search descriptions..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 h-9 bg-background"
            />
          </div>

          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-muted-foreground" />
          </div>

          {/* Category filter */}
          <Select value={filterCategory} onValueChange={setFilterCategory}>
            <SelectTrigger className="w-[160px] h-9 bg-background">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {DEFAULT_CATEGORIES.map((cat) => {
                const display = getCategoryDisplay(cat.id);
                const IconComponent = display.icon;
                return (
                  <SelectItem key={cat.id} value={cat.id}>
                    <span className="flex items-center gap-2">
                      <IconComponent className="w-3 h-3" style={{ color: display.color }} />
                      {cat.name}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>

          {/* Type filter */}
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-[120px] h-9 bg-background">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="income">Income</SelectItem>
              <SelectItem value="expense">Expense</SelectItem>
              <SelectItem value="transfer">Transfer</SelectItem>
            </SelectContent>
          </Select>

          {/* Anomaly filter */}
          {activeAnomalyCount > 0 && (
            <Button
              variant={filterAnomaly ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterAnomaly(!filterAnomaly)}
              className={cn(
                "h-9",
                filterAnomaly
                  ? "bg-amber-500 hover:bg-amber-600 text-white"
                  : "border-amber-500/50 text-amber-600 hover:bg-amber-500/10"
              )}
            >
              <AlertTriangle className="w-4 h-4 mr-1" />
              Anomalies ({activeAnomalyCount})
            </Button>
          )}

          {/* Needs Review filter */}
          {needsReviewCount > 0 && (
            <Button
              variant={filterNeedsReview ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterNeedsReview(!filterNeedsReview)}
              className={cn(
                "h-9",
                filterNeedsReview
                  ? "bg-blue-500 hover:bg-blue-600 text-white"
                  : "border-blue-500/50 text-blue-600 hover:bg-blue-500/10"
              )}
              title="Show only transactions with low confidence categorization"
            >
              <AlertCircle className="w-4 h-4 mr-1" />
              Needs Review ({needsReviewCount})
            </Button>
          )}

          {/* Clear filters */}
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="h-9 text-muted-foreground"
            >
              <X className="w-4 h-4 mr-1" />
              Clear
            </Button>
          )}

          {/* Selection actions - only show when items selected */}
          {selectedCount > 0 && (
            <div className="flex items-center gap-2 ml-auto pl-4 border-l border-border">
              <span className="text-sm text-muted-foreground">
                {selectedCount} selected
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleCategorizeSelected}
                disabled={isCategorizing}
              >
                Reprocess Selected
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearSelection}
                className="text-muted-foreground"
              >
                Clear
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto p-4">
        <div className="rounded-lg border px-5 h-full">
          <Table>
          <TableHeader className="sticky top-0 bg-background z-10">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10 border-r border-border/30">
                <div className="flex items-center justify-center">
                  <Checkbox
                    checked={isAllSelected}
                    onCheckedChange={handleSelectAll}
                    aria-label="Select all"
                  />
                </div>
              </TableHead>
              <TableHead className="w-28 border-r border-border/30">Date</TableHead>
              <TableHead className="border-r border-border/30">Description</TableHead>
              <TableHead className="w-36 text-right border-r border-border/30">Amount</TableHead>
              <TableHead className="w-20 text-center border-r border-border/30">Type</TableHead>
              <TableHead className="w-56">Category</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredTransactions.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center py-12 text-muted-foreground"
                >
                  {hasFilters
                    ? "No transactions match your filters"
                    : "No transactions yet"}
                </TableCell>
              </TableRow>
            ) : (
              filteredTransactions.map((transaction, index) => {
                const isSelected = selectedIds.includes(transaction.id);

                return (
                  <TableRow
                    key={transaction.id}
                    data-selected={isSelected}
                    className={cn(
                      // Zebra striping
                      index % 2 === 1 && "bg-muted/20",
                      // Selected state
                      isSelected && "bg-primary/5",
                      // Hover state
                      "hover:bg-muted/40 transition-colors",
                      // Needs review highlight
                      transaction.needsReview && "bg-amber-500/5",
                      // Anomaly highlight (only for non-dismissed)
                      transaction.isAnomaly && !transaction.anomalyDismissed && "bg-amber-500/5"
                    )}
                  >
                    {/* Checkbox */}
                    <TableCell className="w-10 border-r border-border/30">
                      <div className="flex items-center justify-center">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleSelection(transaction.id)}
                          aria-label={`Select ${transaction.description}`}
                        />
                      </div>
                    </TableCell>

                    {/* Date */}
                    <TableCell className="font-mono text-sm text-muted-foreground border-r border-border/30">
                      {format(
                        transaction.date instanceof Date
                          ? transaction.date
                          : new Date(transaction.date),
                        "dd MMM yyyy"
                      )}
                    </TableCell>

                    {/* Description */}
                    <TableCell className="border-r border-border/30">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium text-foreground">
                          {transaction.merchant || transaction.description}
                        </span>
                        {transaction.merchant && (
                          <span className="text-xs text-muted-foreground">
                            {transaction.description}
                          </span>
                        )}
                        <div className="flex items-center gap-2 mt-0.5">
                          {transaction.sourceType === "credit_card" && (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <CreditCard className="w-3 h-3" />
                              {transaction.cardIssuer}
                            </span>
                          )}
                          {transaction.currency && transaction.currency !== "INR" && (
                            <span className="text-xs text-muted-foreground">
                              {transaction.originalAmount?.toFixed(2)} {transaction.currency}
                            </span>
                          )}
                        </div>
                      </div>
                    </TableCell>

                    {/* Amount */}
                    <TableCell className="text-right border-r border-border/30">
                      <div className="flex items-center justify-end gap-2">
                        {/* Anomaly badge */}
                        {transaction.isAnomaly && !transaction.anomalyDismissed && (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/20 text-amber-600 shrink-0 cursor-help"
                            title={`Anomaly detected: ${transaction.anomalyTypes?.map(t => ANOMALY_LABELS[t]).join(', ')}${
                              transaction.anomalyDetails?.amountDeviation
                                ? ` (${transaction.anomalyDetails.amountDeviation.toFixed(1)}x std dev)`
                                : ''
                            }${
                              transaction.anomalyDetails?.frequencyCount
                                ? ` (${transaction.anomalyDetails.frequencyCount} in ${transaction.anomalyDetails.frequencyPeriod})`
                                : ''
                            }`}
                          >
                            <AlertTriangle className="w-3 h-3" />
                            Anomaly
                          </span>
                        )}
                        <span
                          className={cn(
                            "font-mono font-semibold tabular-nums",
                            transaction.isIncome
                              ? "text-success"
                              : transaction.isExcluded
                              ? "text-muted-foreground"
                              : "text-foreground"
                          )}
                        >
                          {transaction.isIncome ? "+" : transaction.isExpense ? "-" : ""}
                          {formatCurrency(Math.abs(transaction.amount), currency, false)}
                        </span>
                      </div>
                    </TableCell>

                    {/* Type */}
                    <TableCell className="text-center border-r border-border/30">
                      <span
                        className={cn(
                          "text-xs font-medium",
                          transaction.isIncome && "text-success",
                          transaction.isExpense && "text-muted-foreground",
                          transaction.isExcluded && "text-muted-foreground"
                        )}
                      >
                        {transaction.isCredit ? "Credit" : "Debit"}
                      </span>
                    </TableCell>

                    {/* Category */}
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <InlineCategoryEditor
                          categoryId={transaction.category.id}
                          isIncome={transaction.isIncome}
                          needsReview={transaction.needsReview}
                          onCategoryChange={(newCat) => handleCategoryChange(transaction.id, newCat)}
                        />
                        {/* Dismiss/Restore anomaly button */}
                        {transaction.isAnomaly && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              if (transaction.anomalyDismissed) {
                                restoreAnomaly(transaction.id);
                                toast.success("Anomaly restored");
                              } else {
                                dismissAnomaly(transaction.id);
                                toast.success("Anomaly dismissed");
                              }
                            }}
                            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                          >
                            {transaction.anomalyDismissed ? (
                              <>
                                <Undo2 className="w-3 h-3 mr-1" />
                                Restore
                              </>
                            ) : (
                              <>
                                <X className="w-3 h-3 mr-1" />
                                Dismiss
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-border bg-muted/20 shrink-0 px-6 py-2 text-sm text-muted-foreground">
        <div className="flex items-center justify-between">
          <span>
            Showing {filteredTransactions.length} of {transactions.length}
          </span>
          {needsReviewCount > 0 && (
            <Button
              variant="link"
              size="sm"
              onClick={handleCategorizeNeedsReview}
              disabled={isCategorizing}
              className="text-amber-600 hover:text-amber-700 p-0 h-auto"
              title="Re-run AI categorization on transactions with low confidence scores to improve their categories"
            >
              <AlertCircle className="w-3 h-3 mr-1" />
              Reprocess {needsReviewCount} needing review
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TransactionsPage() {
  return (
    <Suspense fallback={
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    }>
      <TransactionsPageContent />
    </Suspense>
  );
}
