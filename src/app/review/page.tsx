"use client";

import { useEffect, useState, useMemo } from "react";
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
import { Transaction } from "@/types";
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
    // Convert date strings back to Date objects
    return parsed.map((t: Transaction & { date: string }) => ({
      ...t,
      date: new Date(t.date),
    }));
  } catch {
    return [];
  }
}

export default function ReviewPage() {
  const router = useRouter();
  const [pendingTransactions, setPendingTransactions] = useState<Transaction[]>(loadPendingTransactions);
  const [editingId, setEditingId] = useState<string | null>(null);
  const addTransactions = useTransactionStore((state) => state.addTransactions);
  const clearAll = useTransactionStore((state) => state.clearAll);
  const startBackgroundCategorization = useTransactionStore((state) => state.startBackgroundCategorization);
  const currency = useSettingsStore((state) => state.currency);

  // Track if we've checked for redirect (avoids flash)
  const hasNoTransactions = useMemo(() => pendingTransactions.length === 0, [pendingTransactions.length]);

  // Redirect if no transactions (navigation is a side effect, OK in useEffect)
  useEffect(() => {
    if (hasNoTransactions) {
      // Small delay to avoid flash on initial load
      const timer = setTimeout(() => {
        router.push("/");
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [hasNoTransactions, router]);

  const handleEditField = (
    id: string,
    field: keyof Transaction,
    value: string | number | Date | undefined,
  ) => {
    setPendingTransactions((prev) =>
      prev.map((t) => (t.id === id ? { ...t, [field]: value } : t)),
    );
  };

  const handleDeleteTransaction = (id: string) => {
    setPendingTransactions((prev) => prev.filter((t) => t.id !== id));
  };

  const handleConfirmImport = () => {
    if (pendingTransactions.length === 0) {
      alert("No transactions to import!");
      return;
    }

    // Clear old data before importing new transactions
    clearAll();
    addTransactions(pendingTransactions);
    sessionStorage.removeItem("pendingTransactions");

    // Start background categorization (5 second delay)
    startBackgroundCategorization();

    router.push("/dashboard");
  };

  const handleCancel = () => {
    sessionStorage.removeItem("pendingTransactions");
    router.push("/");
  };

  if (pendingTransactions.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

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
      <div className="container mx-auto px-4 pb-8">
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[120px]">Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-[150px]">Amount</TableHead>
                <TableHead className="w-[120px]">Type</TableHead>
                <TableHead className="w-[130px]">Balance</TableHead>
                <TableHead className="w-[200px]">Category</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pendingTransactions.map((transaction) => {
                const categoryDisplay = getCategoryDisplay(transaction.category);
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
                        <div>
                          <div className="font-medium">
                            {transaction.merchant || transaction.description}
                          </div>
                          {transaction.merchant && (
                            <div className="text-xs text-muted-foreground">
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
                            const signedValue =
                              transaction.type === "expense"
                                ? -Math.abs(absValue)
                                : Math.abs(absValue);
                            handleEditField(
                              transaction.id,
                              "amount",
                              signedValue,
                            );
                          }}
                          className="w-full"
                        />
                      ) : (
                        <span
                          className={`font-mono font-semibold ${
                            transaction.type === "income"
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
                          onValueChange={(value: "income" | "expense") => {
                            handleEditField(transaction.id, "type", value);
                            // Adjust amount sign
                            const absAmount = Math.abs(transaction.amount);
                            const newAmount =
                              value === "expense" ? -absAmount : absAmount;
                            handleEditField(
                              transaction.id,
                              "amount",
                              newAmount,
                            );
                          }}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="income">Income</SelectItem>
                            <SelectItem value="expense">Expense</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge
                          variant={
                            transaction.type === "income"
                              ? "default"
                              : "secondary"
                          }
                        >
                          {transaction.type === "income" ? "Credit" : "Debit"}
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
                        value={transaction.category}
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
                            (c) =>
                              c.type === transaction.type ||
                              c.type === "both",
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
