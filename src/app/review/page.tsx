"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
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
import { ArrowLeft, CheckCircle, Edit2, Trash2, Download } from "lucide-react";
import { Transaction, TransactionType, Category } from "@/types";
import { useTransactionStore } from "@/lib/store/transactionStore";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { formatCurrency } from "@/lib/currencyFormatter";
import { exportTransactionsToCSV } from "@/lib/exportUtils";
import { format } from "date-fns";
import { DEFAULT_CATEGORIES } from "@/lib/categorization/categories";
import { getCategoryDisplay } from "@/components/transactions/CategoryBadge";

// Helper to load transactions from sessionStorage
function loadPendingTransactions(): Transaction[] {
  if (typeof window === "undefined") return [];
  const stored = sessionStorage.getItem("pendingTransactions");
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    // Reconstruct Transaction instances from JSON
    return parsed.map((t: { date: string; category: string; [key: string]: unknown }) => {
      return new Transaction(
        t.id as string,
        new Date(t.date),
        t.description as string,
        t.amount as number,
        t.type as TransactionType,
        Category.fromId(t.category) ?? Category.fromId(Category.DEFAULT_ID)!,
        t.balance as number | undefined,
        t.merchant as string | undefined,
        t.originalText as string | undefined,
        t.budgetMonth as string | undefined,
        t.categoryConfidence as number | undefined,
        t.needsReview as boolean | undefined,
        t.categorizedBy as undefined,
        t.sourceType as undefined,
        t.statementId as string | undefined,
        t.cardIssuer as string | undefined,
        t.cardLastFour as string | undefined,
        t.cardHolder as string | undefined,
        t.currency as string | undefined,
        t.originalAmount as number | undefined,
        t.isAnomaly as boolean | undefined,
        t.anomalyTypes as undefined,
        t.anomalyDetails as undefined,
        t.anomalyDismissed as boolean | undefined,
      );
    });
  } catch {
    return [];
  }
}

export default function ReviewPage() {
  const router = useRouter();
  // null = not loaded yet, empty array = loaded but no transactions
  // Use lazy initialization to read from sessionStorage once on mount
  const [pendingTransactions, setPendingTransactions] = useState<Transaction[] | null>(() => loadPendingTransactions());
  const [editingId, setEditingId] = useState<string | null>(null);
  const addTransactions = useTransactionStore((state) => state.addTransactions);
  const startBackgroundCategorization = useTransactionStore((state) => state.startBackgroundCategorization);
  const runAnomalyDetection = useTransactionStore((state) => state.runAnomalyDetection);
  const currency = useSettingsStore((state) => state.currency);

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
        // Create new Transaction with updated field
        return new Transaction(
          field === 'id' ? (value as string) : t.id,
          field === 'date' ? (value as Date) : t.date,
          field === 'description' ? (value as string) : t.description,
          field === 'amount' ? (value as number) : t.amount,
          field === 'type' ? (value as TransactionType) : t.type,
          field === 'category' ? (Category.fromId(value as string) || t.category) : t.category,
          field === 'balance' ? (value as number | undefined) : t.balance,
          field === 'merchant' ? (value as string | undefined) : t.merchant,
          field === 'originalText' ? (value as string | undefined) : t.originalText,
          field === 'budgetMonth' ? (value as string | undefined) : t.budgetMonth,
          field === 'categoryConfidence' ? (value as number | undefined) : t.categoryConfidence,
          field === 'needsReview' ? (value as boolean | undefined) : t.needsReview,
          t.categorizedBy,
          t.sourceType,
          t.statementId,
          t.cardIssuer,
          t.cardLastFour,
          t.cardHolder,
          t.currency,
          t.originalAmount,
          t.isAnomaly,
          t.anomalyTypes,
          t.anomalyDetails,
          t.anomalyDismissed,
        );
      });
    });
  };

  const handleDeleteTransaction = (id: string) => {
    setPendingTransactions((prev) => prev?.filter((t) => t.id !== id) ?? prev);
  };

  const handleConfirmImport = () => {
    if (pendingTransactions.length === 0) {
      alert("No transactions to import!");
      return;
    }

    // Append new transactions to existing ones
    addTransactions(pendingTransactions);
    sessionStorage.removeItem("pendingTransactions");

    // Start background categorization (5 second delay)
    startBackgroundCategorization();

    // Run anomaly detection on all transactions
    runAnomalyDetection();

    router.push("/dashboard");
  };

  const handleCancel = () => {
    sessionStorage.removeItem("pendingTransactions");
    router.push("/");
  };

  return (
    <div className="min-h-screen bg-background">
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
                <p className="text-sm text-muted-foreground">
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

      {/* Instructions */}
      <div className="container mx-auto px-4 py-4">
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-4">
            <p className="text-sm">
              <strong>💡 Tip:</strong> Review each transaction carefully. Click
              on any field to edit it. Make sure amounts, dates, and
              descriptions are correct before importing.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Transactions Table */}
      <div className="w-[95%] mx-auto pb-8">
        <div className="rounded-lg border px-5">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[120px]">Date</TableHead>
                <TableHead className="max-w-[60%]">Description</TableHead>
                <TableHead className="w-[150px]">Amount</TableHead>
                <TableHead className="w-[120px]">Type</TableHead>
                <TableHead className="w-[130px]">Balance</TableHead>
                <TableHead className="w-[200px]">Category</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pendingTransactions.map((transaction) => {
                const categoryDisplay = getCategoryDisplay(transaction.category.id);
                const isEditing = editingId === transaction.id;

                return (
                  <TableRow key={transaction.id}>
                    {/* Date */}
                    <TableCell className="font-mono text-sm">
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
                    <TableCell className="max-w-[400px]">
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
                    <TableCell>
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
                            transaction.isIncome
                              ? "text-success"
                              : "text-destructive"
                          }`}
                        >
                          {formatCurrency(transaction.amount, currency)}
                        </span>
                      )}
                    </TableCell>

                    {/* Type */}
                    <TableCell>
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
                          variant={
                            transaction.isIncome
                              ? "default"
                              : "secondary"
                          }
                        >
                          {transaction.isCredit ? "Credit" : "Debit"}
                        </Badge>
                      )}
                    </TableCell>

                    {/* Balance */}
                    <TableCell className="font-mono text-sm text-muted-foreground">
                      {transaction.balance !== undefined &&
                      transaction.balance !== null
                        ? formatCurrency(transaction.balance, currency, false)
                        : "—"}
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
                          {DEFAULT_CATEGORIES.filter(
                            (c) => !c.isExcluded,
                          ).map((cat) => {
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
                        </SelectContent>
                      </Select>
                    </TableCell>

                    {/* Actions */}
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            setEditingId(isEditing ? null : transaction.id)
                          }
                        >
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            handleDeleteTransaction(transaction.id)
                          }
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
