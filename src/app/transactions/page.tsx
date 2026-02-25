"use client";

export const dynamic = "force-dynamic";

import { useState, useMemo, useCallback } from "react";
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
  Loader2,
  CreditCard,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { formatCurrency } from "@/lib/currencyFormatter";
import { getCategoryDisplay } from "@/components/transactions/CategoryBadge";
import { InlineCategoryEditor } from "@/components/transactions/InlineCategoryEditor";
import { DEFAULT_CATEGORIES } from "@/lib/categorization/categories";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function TransactionsPage() {
  const transactions = useTransactionStore((state) => state.transactions);
  const selectedIds = useTransactionStore((state) => state.selectedIds);
  const toggleSelection = useTransactionStore((state) => state.toggleSelection);
  const clearSelection = useTransactionStore((state) => state.clearSelection);
  const updateCategory = useTransactionStore((state) => state.updateCategory);
  const getTransactionsNeedingReview = useTransactionStore((state) => state.getTransactionsNeedingReview);

  const currency = useSettingsStore((state) => state.currency);
  const llmProvider = useSettingsStore((state) => state.llmProvider);
  const ollamaUrl = useSettingsStore((state) => state.ollamaUrl);
  const llmModel = useSettingsStore((state) => state.llmModel);

  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [isCategorizing, setIsCategorizing] = useState(false);

  const filteredTransactions = useMemo(() => {
    return transactions
      .filter((t) => {
        const matchesSearch = t.description
          .toLowerCase()
          .includes(searchTerm.toLowerCase());
        const matchesCategory =
          filterCategory === "all" || t.category === filterCategory;
        const matchesType = filterType === "all" || t.type === filterType;

        return matchesSearch && matchesCategory && matchesType;
      })
      .sort((a, b) => {
        const dateA = a.date instanceof Date ? a.date : new Date(a.date);
        const dateB = b.date instanceof Date ? b.date : new Date(b.date);
        return dateB.getTime() - dateA.getTime();
      });
  }, [transactions, searchTerm, filterCategory, filterType]);

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
    updateCategory(transactionId, newCategory, "manual");
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
          categorizedBy: result.confidence >= 0.3 ? "ai" : "keyword",
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

  const hasFilters = searchTerm || filterCategory !== "all" || filterType !== "all";

  const clearFilters = () => {
    setSearchTerm("");
    setFilterCategory("all");
    setFilterType("all");
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
      <div className="flex-1 overflow-auto">
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
                      transaction.needsReview && "bg-amber-500/5"
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
                      <span
                        className={cn(
                          "font-mono font-semibold tabular-nums",
                          transaction.type === "income"
                            ? "text-success"
                            : transaction.type === "transfer"
                            ? "text-muted-foreground"
                            : "text-foreground"
                        )}
                      >
                        {transaction.type === "income" ? "+" : transaction.type === "expense" ? "-" : ""}
                        {formatCurrency(Math.abs(transaction.amount), currency, false)}
                      </span>
                    </TableCell>

                    {/* Type */}
                    <TableCell className="text-center border-r border-border/30">
                      <span
                        className={cn(
                          "text-xs font-medium",
                          transaction.type === "income" && "text-success",
                          transaction.type === "expense" && "text-muted-foreground",
                          transaction.type === "transfer" && "text-muted-foreground"
                        )}
                      >
                        {transaction.type === "income" ? "Credit" : transaction.type === "transfer" ? "Transfer" : "Debit"}
                      </span>
                    </TableCell>

                    {/* Category */}
                    <TableCell>
                      <InlineCategoryEditor
                        categoryId={transaction.category}
                        transactionType={transaction.type}
                        needsReview={transaction.needsReview}
                        onCategoryChange={(newCat) => handleCategoryChange(transaction.id, newCat)}
                      />
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
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
