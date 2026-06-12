"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, CheckCircle, Download } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Transaction } from "@/types";
import { useTransactionStore } from "@/lib/store/transactionStore";
import { useCreditCardStore } from "@/lib/store/creditCardStore";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { exportTransactionsToCSV } from "@/lib/exportUtils";
import { VerificationSummary } from "@/components/upload/VerificationSummary";
import { reviewSessionRepository } from "@/lib/review/reviewSessionRepository";
import { finalizeReviewImport } from "@/lib/pipelines/postReviewPipeline";
import { ReviewTransactionRow } from "@/components/review/ReviewTransactionRow";
import { ReviewEditDialog } from "@/components/review/ReviewEditDialog";

export default function ReviewPage() {
  const router = useRouter();
  const [reviewSession] = useState(() => {
    const t0 = performance.now();
    const session = reviewSessionRepository.load();
    console.log(`[Review] session.load: ${Math.round(performance.now() - t0)}ms (${session?.transactions.length ?? 0} txns)`);
    return session;
  });
  const [pendingTransactions, setPendingTransactions] = useState<Transaction[] | null>(
    () => reviewSession?.transactions ?? []
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const addTransactions = useTransactionStore((state) => state.addTransactions);
  const addCCStatement = useCreditCardStore((state) => state.addStatement);
  const currency = useSettingsStore((state) => state.currency);
  const verificationReport = reviewSession?.verificationReport ?? null;

  const editingTransaction = pendingTransactions?.find((t) => t.id === editingId) ?? null;
  const suspenseCount = pendingTransactions?.filter(t => t.isSuspense).length ?? 0;

  const handleEditSave = useCallback(
    (id: string, updates: Record<string, unknown>) => {
      const t0 = performance.now();
      setPendingTransactions((prev) => {
        if (!prev) return prev;
        return prev.map((t) => {
          if (t.id !== id) return t;
          // Clear suspense flag when category changes — expanded CategoryType handles routing
          if (t.isSuspense && typeof updates.category === "string") {
            return t.cloneWith({
              ...updates,
              isSuspense: false,
            });
          }
          return t.cloneWith(updates);
        });
      });
      console.log(`[Review] editSave: ${Math.round(performance.now() - t0)}ms`);
    },
    [],
  );

  const handleStartEdit = useCallback((id: string) => {
    const t0 = performance.now();
    setEditingId(id);
    queueMicrotask(() => console.log(`[Review] startEdit: ${Math.round(performance.now() - t0)}ms`));
  }, []);

  const handleCloseEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  const handleDeleteTransaction = useCallback((id: string) => {
    const t0 = performance.now();
    setPendingTransactions((prev) => prev?.filter((t) => t.id !== id) ?? prev);
    console.log(`[Review] delete: ${Math.round(performance.now() - t0)}ms`);
  }, []);

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

  const handleConfirmImport = () => {
    if (editingId) {
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

    const t0 = performance.now();
    await finalizeReviewImport(pendingTransactions, {
      addTransactions,
      addCreditCardStatement: addCCStatement,
      addBankSummary: useTransactionStore.getState().addBankSummary,
    });
    console.log(`[Review] import: ${Math.round(performance.now() - t0)}ms`);

    router.push("/dashboard");
  };

  const handleCancel = () => {
    const t0 = performance.now();
    reviewSessionRepository.clear();
    console.log(`[Review] cancel: ${Math.round(performance.now() - t0)}ms`);
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
                  {suspenseCount > 0 && (
                    <span className="text-amber-600 dark:text-amber-400 ml-2">
                      • {suspenseCount} need{suspenseCount !== 1 ? "s" : ""} classification
                    </span>
                  )}
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
              <Button onClick={handleConfirmImport} disabled={suspenseCount > 0}>
                <CheckCircle className="w-4 h-4 mr-2" />
                Confirm & Import
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Verification Summary */}
      {verificationReport && (
        <div className="w-[80vw] mx-auto pb-4">
          <VerificationSummary report={verificationReport} currency={currency} />
        </div>
      )}

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
              {pendingTransactions.map((transaction) => (
                <ReviewTransactionRow
                  key={transaction.id}
                  transaction={transaction}
                  currency={currency}
                  onEdit={handleStartEdit}
                  onDelete={handleDeleteTransaction}
                />
              ))}
            </TableBody>
          </Table>
          </div>
        </div>
      </div>

      {/* Edit Dialog */}
      <ReviewEditDialog
        key={editingId}
        transaction={editingTransaction}
        open={editingId !== null}
        onOpenChange={(open) => {
          if (!open) handleCloseEdit();
        }}
        onSave={handleEditSave}
      />

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
