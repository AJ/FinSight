"use client";

export const dynamic = "force-dynamic";

import { useState, useMemo, useCallback, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useTransactionStore } from "@/lib/store/transactionStore";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { debugError } from '@/lib/utils/debug';
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
  Landmark,
  SlidersHorizontal,
  X,
  Undo2,
} from "lucide-react";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/currencyFormatter";
import { getCategoryDisplay } from "@/components/transactions/CategoryBadge";
import { InlineCategoryEditor } from "@/components/transactions/InlineCategoryEditor";
import { needsAttention } from "@/lib/review/reviewReasons";
import { DEFAULT_CATEGORIES } from "@/lib/categorization/categories";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ANOMALY_LABELS } from "@/lib/anomaly";
import { CategorizedBy } from "@/types";
import {
  applyFilters,
  activeAnomalyCount as countActiveAnomalies,
  hasFilters as hasActiveFilters,
  isAllSelected as computeIsAllSelected,
  type FilterState,
} from "./pageFilters";

// Category filter lists alphabetically (registration order is irrelevant to the
// UI — it only matters for the LLM prompt). "other" is pinned last to match the
// ReviewEditDialog and InlineCategoryEditor convention.
const SORTED_CATEGORY_FILTERS = (() => {
  const regular = DEFAULT_CATEGORIES.filter((c) => c.id !== "other").sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const other = DEFAULT_CATEGORIES.find((c) => c.id === "other");
  return other ? [...regular, other] : regular;
})();

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
  const llmServerUrl = useSettingsStore((state) => state.llmServerUrl);
  const llmModel = useSettingsStore((state) => state.llmModel);

  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterSource, setFilterSource] = useState<string>("all");
  const [filterAnomaly, setFilterAnomaly] = useState<boolean>(
    searchParams.get("anomaly") === "true"
  );
  const [filterNeedsReview, setFilterNeedsReview] = useState<boolean>(false);
  const [isCategorizing, setIsCategorizing] = useState(false);

  // Count active anomalies
  const activeAnomalyCount = useMemo(
    () => countActiveAnomalies(transactions),
    [transactions],
  );

  const filterState = useMemo<FilterState>(
    () => ({
      search: searchTerm,
      category: filterCategory,
      type: filterType as FilterState["type"],
      source: filterSource as FilterState["source"],
      anomalyOnly: filterAnomaly,
      needsReviewOnly: filterNeedsReview,
    }),
    [searchTerm, filterCategory, filterType, filterSource, filterAnomaly, filterNeedsReview],
  );

  const filteredTransactions = useMemo(
    () => applyFilters(transactions, filterState),
    [transactions, filterState],
  );

  // Auto-clear anomaly filter when no anomalies remain
  useEffect(() => {
    if (filterAnomaly && activeAnomalyCount === 0) {
      setFilterAnomaly(false);
    }
  }, [filterAnomaly, activeAnomalyCount]);

  const needsReviewCount = getTransactionsNeedingReview().length;
  const selectedCount = selectedIds.length;
  const isAllSelected = computeIsAllSelected(filteredTransactions, selectedIds);

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
      const { recategorizeStoredTransactions } = await import("@/lib/services/transactionEnrichmentService");
      const recategorizedTransactions = await recategorizeStoredTransactions(txns, {
        provider: llmProvider,
        baseUrl: llmServerUrl,
        model: llmModel || undefined,
      });

      let reviewCount = 0;
      for (const transaction of recategorizedTransactions) {
        if (needsAttention(transaction.reviewReasons)) reviewCount++;
        useTransactionStore.getState().updateTransaction(transaction.id, {
          merchant: transaction.merchant,
          category: transaction.category,
          categoryConfidence: transaction.categoryConfidence,
          categorizedBy: transaction.categorizedBy,
          reviewReasons: transaction.reviewReasons,
        });
      }

      toast.success("Categorization complete", {
        id: toastId,
        description: `${recategorizedTransactions.length} categorized. ${reviewCount} need review.`
      });
    } catch (error) {
      debugError('Categorize', error);
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
  // DEFERRED: the "Reprocess needing review" button is hidden pending the dismiss
  // CTA (spec §6.4 — persisting advisories are math/fingerprint, which re-running
  // classification can't clear). When dismiss lands, this becomes the dismiss handler.
  // const handleCategorizeNeedsReview = () => {
  //   runCategorization(getTransactionsNeedingReview());
  // };

  const hasFilters = hasActiveFilters(filterState);

  const clearFilters = () => {
    setSearchTerm("");
    setFilterCategory("all");
    setFilterType("all");
    setFilterSource("all");
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
              {SORTED_CATEGORY_FILTERS.map((cat) => {
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

          {/* Source filter */}
          <Select value={filterSource} onValueChange={setFilterSource}>
            <SelectTrigger className="w-[140px] h-9 bg-background">
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sources</SelectItem>
              <SelectItem value="bank">
                <span className="flex items-center gap-2">
                  <Landmark className="w-3 h-3" />
                  Bank
                </span>
              </SelectItem>
              <SelectItem value="credit_card">
                <span className="flex items-center gap-2">
                  <CreditCard className="w-3 h-3" />
                  Credit Card
                </span>
              </SelectItem>
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
                      needsAttention(transaction.reviewReasons) && "bg-amber-500/5",
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
                          {transaction.isInternational && transaction.originalCurrency && (
                            <span className="text-xs text-muted-foreground">
                              {transaction.originalAmount?.toFixed(2)} {transaction.originalCurrency.code}
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
                          needsAttention={needsAttention(transaction.reviewReasons)}
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
          {/* DEFERRED: "Reprocess needing review" button. Under the list model the
              persisting advisory (fingerprint_collision) isn't cleared by re-running
              classification, so this button's old behavior no longer fits. It will be
              replaced by a dismiss CTA — see handler note above. */}
          {/* needsReviewCount > 0 && (
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
          ) */}
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
