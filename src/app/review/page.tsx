"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, CheckCircle, Edit2, Trash2, Download, Check, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Transaction, TransactionType, Category, CategorizedBy } from "@/types";
import { useTransactionStore } from "@/lib/store/transactionStore";
import { useCreditCardStore } from "@/lib/store/creditCardStore";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { formatCurrency } from "@/lib/currencyFormatter";
import { exportTransactionsToCSV } from "@/lib/exportUtils";
import { format } from "date-fns";
import { DEFAULT_CATEGORIES } from "@/lib/categorization/categories";
import { getCategoryDisplay } from "@/components/transactions/CategoryBadge";
import { VerificationSummary } from "@/components/upload/VerificationSummary";
import { reviewSessionRepository } from "@/lib/review/reviewSessionRepository";
import { finalizeReviewImport } from "@/lib/pipelines/postReviewPipeline";

export default function ReviewPage() {
  const router = useRouter();
  const [reviewSession] = useState(() => reviewSessionRepository.load());
  const [pendingTransactions, setPendingTransactions] = useState<Transaction[] | null>(
    () => reviewSession?.transactions ?? []
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const addTransactions = useTransactionStore((state) => state.addTransactions);
  const addCCStatement = useCreditCardStore((state) => state.addStatement);
  const currency = useSettingsStore((state) => state.currency);
  const verificationReport = reviewSession?.verificationReport ?? null;

  // Redirect if no transactions after loading (navigation is a side effect, OK in useEffect)
  useEffect(() => {
    if (pendingTransactions !== null && pendingTransactions.length === 0) {
      const timer = setTimeout(() => {
        router.push("/");
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [pendingTransactions, router]);

  // Show loading state while fetching from sessionStorage
  if (pendingTransactions === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  const handleEditField = (
    id: string,
    field: keyof Transaction,
    value: string | number | Date | TransactionType | undefined,
  ) => {
    setPendingTransactions((prev) => {
      if (!prev) return prev;
      return prev.map((t) => {
        if (t.id !== id) return t;
        const updatedTransaction = Transaction.fromJSON({
          ...t.toJSON(),
          id: field === "id" ? (value as string) : t.id,
          date:
            field === "date"
              ? (value as Date).toISOString()
              : t.date.toISOString(),
          description: field === "description" ? (value as string) : t.description,
          amount: field === "amount" ? (value as number) : t.amount,
          type: field === "type" ? (value as TransactionType) : t.type,
          category:
            field === "category"
              ? (Category.fromId(value as string) || t.category).id
              : t.category.id,
          balance: field === "balance" ? (value as number | undefined) : t.balance,
          merchant: field === "merchant" ? (value as string | undefined) : t.merchant,
          originalText:
            field === "originalText" ? (value as string | undefined) : t.originalText,
          budgetMonth:
            field === "budgetMonth" ? (value as string | undefined) : t.budgetMonth,
          categoryConfidence:
            field === "categoryConfidence"
              ? (value as number | undefined)
              : t.categoryConfidence,
          needsReview:
            field === "category"
              ? false
              : field === "needsReview"
                ? (value as boolean | undefined)
                : t.needsReview,
          categorizedBy:
            field === "category" ? CategorizedBy.Manual : t.categorizedBy,
          transactionSubType:
            field === "transactionSubType"
              ? (value as Transaction["transactionSubType"])
              : t.transactionSubType,
          suggestedCategory:
            field === "suggestedCategory"
              ? (value as string | undefined)
              : t.suggestedCategory,
        });

        return updatedTransaction;
      });
    });
  };

  const handleDeleteTransaction = (id: string) => {
    setPendingTransactions((prev) => prev?.filter((t) => t.id !== id) ?? prev);
  };

  const handleSaveEdit = () => {
    // Just exit edit mode - changes are already applied via handleEditField
    setEditingId(null);
  };

  const handleConfirmImport = () => {
    if (editingId) {
      // There are unsaved changes
      setShowUnsavedModal(true);
      return;
    }

    void proceedWithImport();
  };

  const proceedWithImport = async () => {
    if (pendingTransactions.length === 0) {
      alert("No transactions to import!");
      return;
    }

    await finalizeReviewImport(pendingTransactions, {
      addTransactions,
      addCreditCardStatement: addCCStatement,
    });

    router.push("/dashboard");
  };

  const handleCancel = () => {
    reviewSessionRepository.clear();
    router.push("/");
  };

  return (
    <div className="min-h-screen bg-background w-full max-w-[100vw]">
      {/* Header */}
      <div className="border-b">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="outline" size="icon" onClick={handleCancel}>
                <ArrowLeft className="w-4 h-4" />
              </Button>
              <div>
                <h1 className="text-3xl font-bold">Review Transactions</h1>
                <p className="text-sm text-muted-foreground" suppressHydrationWarning>
                  Review and edit before importing •{" "}
                  {pendingTransactions.length} transactions
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => exportTransactionsToCSV(pendingTransactions)}
              >
                <Download className="w-4 h-4 mr-2" />
                Export CSV
              </Button>
              <Button variant="outline" onClick={handleCancel}>
                Cancel
              </Button>
              <Button onClick={handleConfirmImport}>
                <CheckCircle className="w-4 h-4 mr-2" />
                Confirm & Import
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Transactions Table */}
      <div className="flex justify-center pb-4">
        <div className="w-[80vw] mx-auto pb-4">
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[8%] text-center">Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-[8%] text-right pr-2">Amount</TableHead>
                  <TableHead className="w-[5%] text-center">Type</TableHead>
                  <TableHead className="w-[8%] text-center">Subtype</TableHead>
                  <TableHead className="w-[15%] text-center">Category</TableHead>
                  <TableHead className="w-[5%] text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
            <TableBody>
              {pendingTransactions.map((transaction) => {
                const categoryDisplay = getCategoryDisplay(transaction.category.id);
                const isEditing = editingId === transaction.id;

                return (
                  <TableRow 
                    key={transaction.id}
                    className={cn(
                      "border-b-2",
                      // Low confidence highlighting (yellow/orange borders)
                      transaction.verificationConfidence !== undefined && transaction.verificationConfidence < 0.5 && "border-orange-400 border-dashed",
                      transaction.verificationConfidence !== undefined && transaction.verificationConfidence >= 0.5 && transaction.verificationConfidence < 0.75 && "border-yellow-400 border-dashed",
                      // Confidence mismatch highlighting (red border)
                      transaction.llmConfidence !== undefined && transaction.verificationConfidence !== undefined &&
                      Math.abs(transaction.llmConfidence - transaction.verificationConfidence) > 0.3 && "border-red-400 border-dotted"
                    )}
                  >
                    {/* Date */}
                    <TableCell className="font-mono text-sm text-center">
                      {isEditing ? (
                        <Input
                          type="date"
                          value={format(transaction.date, "yyyy-MM-dd")}
                          onChange={(e) => {
                            const newDate = new Date(e.target.value);
                            handleEditField(transaction.id, "date", newDate);
                          }}
                          className="w-full"
                        />
                      ) : (
                        format(transaction.date, "dd MMM yyyy")
                      )}
                    </TableCell>

                    {/* Description */}
                    <TableCell>
                      {isEditing ? (
                        <Input
                          value={transaction.description}
                          onChange={(e) =>
                            handleEditField(
                              transaction.id,
                              "description",
                              e.target.value,
                            )
                          }
                          className="w-full"
                        />
                      ) : (
                        <div className="break-words">
                          <div className="font-medium line-clamp-2">
                            {transaction.merchant || transaction.description}
                          </div>
                          {transaction.merchant && (
                            <div className="text-xs text-muted-foreground line-clamp-2">
                              {transaction.description}
                            </div>
                          )}
                        </div>
                      )}
                    </TableCell>

                    {/* Amount */}
                    <TableCell className="text-right  pr-2">
                      {isEditing ? (
                        <Input
                          type="number"
                          value={Math.abs(transaction.amount)}
                          onChange={(e) => {
                            const absValue = parseFloat(e.target.value);
                            handleEditField(
                              transaction.id,
                              "amount",
                              absValue,
                            );
                          }}
                          className="w-full"
                        />
                      ) : (
                        <span
                          className={`font-mono font-semibold ${
                            transaction.isCredit
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-rose-600 dark:text-rose-400"
                          }`}
                        >
                          {formatCurrency(transaction.signedAmount, currency)}
                        </span>
                      )}
                    </TableCell>

                    {/* Type */}
                    <TableCell className="text-center">
                      {isEditing ? (
                        <Select
                          value={transaction.type}
                          onValueChange={(value: string) => {
                            handleEditField(transaction.id, "type", value === "credit" ? TransactionType.Credit : TransactionType.Debit);
                          }}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="credit">Credit</SelectItem>
                            <SelectItem value="debit">Debit</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge
                          className={
                            transaction.isCredit
                              ? "bg-emerald-500 text-white hover:bg-emerald-600"
                              : "bg-slate-500 text-white hover:bg-slate-600"
                          }
                        >
                          {transaction.isCredit ? "Credit" : "Debit"}
                        </Badge>
                      )}
                    </TableCell>

                    {/* Subtype */}
                    <TableCell className="text-center">
                      {isEditing ? (
                        <Select
                          value={transaction.transactionSubType || ""}
                          onValueChange={(value: string) => {
                            handleEditField(transaction.id, "transactionSubType", value || undefined);
                          }}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select subtype" />
                          </SelectTrigger>
                          <SelectContent>
                            {/* Debit subtypes */}
                            {transaction.type === "debit" && (
                              <>
                                <SelectItem value="purchase">Purchase</SelectItem>
                                <SelectItem value="fee">Fee</SelectItem>
                                <SelectItem value="tax">Tax</SelectItem>
                                <SelectItem value="interest">Interest</SelectItem>
                                <SelectItem value="charge">Charge</SelectItem>
                                <SelectItem value="adjustment">Adjustment</SelectItem>
                              </>
                            )}
                            {/* Credit subtypes */}
                            {transaction.type === "credit" && (
                              <>
                                <SelectItem value="payment">Payment</SelectItem>
                                <SelectItem value="refund">Refund</SelectItem>
                                <SelectItem value="cashback">Cashback</SelectItem>
                                <SelectItem value="reversal">Reversal</SelectItem>
                                <SelectItem value="adjustment">Adjustment</SelectItem>
                              </>
                            )}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {transaction.transactionSubType || "-"}
                        </span>
                      )}
                    </TableCell>

                    {/* Category */}
                    <TableCell>
                      <Select
                        value={transaction.category.id}
                        onValueChange={(value) =>
                          handleEditField(transaction.id, "category", value)
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue>
                            <span className="flex items-center gap-2">
                              <categoryDisplay.icon
                                className="w-3 h-3"
                                style={{ color: categoryDisplay.color }}
                              />
                              {categoryDisplay.name}
                            </span>
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {(() => {
                            // Sort categories alphabetically, put "Other" at bottom
                            const categories = DEFAULT_CATEGORIES;
                            const otherCategory = categories.find(
                              (c) => c.id === "other",
                            );
                            const regularCategories = categories
                              .filter((c) => c.id !== "other")
                              .sort((a, b) => a.name.localeCompare(b.name));

                            return (
                              <>
                                {regularCategories.map((cat) => {
                                  const display = getCategoryDisplay(cat.id);
                                  const IconComponent = display.icon;
                                  return (
                                    <SelectItem key={cat.id} value={cat.id}>
                                      <span className="flex items-center gap-2">
                                        <IconComponent
                                          className="w-3 h-3"
                                          style={{ color: display.color }}
                                        />
                                        {cat.name}
                                      </span>
                                    </SelectItem>
                                  );
                                })}
                                {/* Separator before "Other" */}
                                <div className="h-px bg-border my-1" />
                                {otherCategory && (() => {
                                  const display = getCategoryDisplay(otherCategory.id);
                                  const IconComponent = display.icon;
                                  return (
                                    <SelectItem key={otherCategory.id} value={otherCategory.id}>
                                      <span className="flex items-center gap-2">
                                        <IconComponent
                                          className="w-3 h-3"
                                          style={{ color: display.color }}
                                        />
                                        {otherCategory.name}
                                      </span>
                                    </SelectItem>
                                  );
                                })()}
                              </>
                            );
                          })()}
                        </SelectContent>
                      </Select>
                    </TableCell>

                    {/* Actions */}
                    <TableCell>
                      {isEditing ? (
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={handleSaveEdit}
                            className="text-emerald-600 hover:text-emerald-700"
                          >
                            <Check className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setEditingId(null)}
                            className="text-rose-600 hover:text-rose-700"
                          >
                            <XCircle className="w-4 h-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setEditingId(transaction.id)}
                          >
                            <Edit2 className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteTransaction(transaction.id)}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </div>
        </div>
      </div>

      {/* Verification Summary - Bottom of page */}
      {verificationReport && (
        <div className="w-[80vw] mx-auto pb-8">
          <VerificationSummary report={verificationReport} />
        </div>
      )}

      {/* Unsaved Changes Modal */}
      <Dialog open={showUnsavedModal} onOpenChange={setShowUnsavedModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unsaved Changes</DialogTitle>
            <DialogDescription>
              You have unsaved edits. What would you like to do?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowUnsavedModal(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setEditingId(null);
                setShowUnsavedModal(false);
              }}
            >
              Discard Changes
            </Button>
            <Button
              onClick={() => {
                setEditingId(null);
                setShowUnsavedModal(false);
                void proceedWithImport();
              }}
            >
              Save & Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


