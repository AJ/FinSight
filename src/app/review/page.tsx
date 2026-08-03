"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, CheckCircle, Download, Loader2 } from "lucide-react";
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
import { hasHardReason, needsAttention } from "@/lib/review/reviewReasons";
import type { ReviewSessionPayload } from "@/lib/pipelines/types";
import { finalizeReviewImport } from "@/lib/pipelines/postReviewPipeline";
import { ReviewTransactionRow } from "@/components/review/ReviewTransactionRow";
import { ReviewEditDialog } from "@/components/review/ReviewEditDialog";

// useSyncExternalStore plumbing for the review session, which lives in sessionStorage — a
// browser-only store. subscribe is a no-op because the session never emits change
// notifications (it is immutable for the page's lifetime; edits live in pendingTransactions).
// getServerSnapshot returns null so SSR HTML and the client's hydration render agree (both
// render "Loading…"), avoiding the hydration mismatch a useState initializer would cause.
function subscribeNoop(): () => void {
  return () => {};
}
function getServerSessionNull(): ReviewSessionPayload | null {
  return null;
}

export default function ReviewPage() {
  const router = useRouter();
  // getSnapshot caches the single load in a ref so repeated calls return a stable reference
  // (required by useSyncExternalStore) and so a re-visit after re-upload doesn't serve a
  // stale session (the ref resets on remount).
  const sessionCacheRef = useRef<ReviewSessionPayload | null | undefined>(undefined);
  const getSession = useCallback((): ReviewSessionPayload | null => {
    if (sessionCacheRef.current === undefined) {
      const t0 = performance.now();
      sessionCacheRef.current = reviewSessionRepository.load();
      console.log(`[Review] session.load: ${Math.round(performance.now() - t0)}ms (${sessionCacheRef.current?.transactions.length ?? 0} txns)`);
    }
    return sessionCacheRef.current;
  }, []);
  const session = useSyncExternalStore(subscribeNoop, getSession, getServerSessionNull);

  const [pendingTransactions, setPendingTransactions] = useState<Transaction[] | null>(null);
  // mounted is false during SSR and the first hydration render, then true on the client. We
  // read it via useSyncExternalStore (server snapshot false, client snapshot true) rather than
  // setState-in-an-effect: it gives the same hydration-safe behavior without tripping the
  // set-state-in-effect rule, and reuses the session's no-op subscribe.
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  // Seed the editable working copy once mounted (client-only). Gating on `mounted` lets us
  // distinguish "still loading / hydrating" from "loaded, but no session": a restored /review
  // tab whose sessionStorage was wiped (browser/system restart, or a stale deep link) resolves
  // to session === null, and we seed [] so the redirect below can fire — previously it stayed
  // null forever and the page hung on the loading screen.
  if (mounted && pendingTransactions === null) {
    setPendingTransactions(session?.transactions ?? []);
  }
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const addTransactions = useTransactionStore((state) => state.addTransactions);
  const addCCStatement = useCreditCardStore((state) => state.addStatement);
  const currency = useSettingsStore((state) => state.currency);
  const verificationReport = session?.verificationReport ?? null;

  const editingTransaction = pendingTransactions?.find((t) => t.id === editingId) ?? null;
  // Commit gate (spec §6.1): blocked while any transaction carries an unresolved
  // hard review reason. Hard reasons are staging-only and resolved via the edit
  // dialog's validate-before-save before they can reach commit.
  const unresolvedCount = pendingTransactions?.filter((t) => hasHardReason(t.reviewReasons)).length ?? 0;
  // "Flagged" = any row needing attention (reviewReasons.length > 0). One definition,
  // shared with the row markers and the VerificationSummary count.
  const flaggedCount = pendingTransactions?.filter((t) => needsAttention(t.reviewReasons)).length ?? 0;

  const handleEditSave = useCallback(
    (id: string, updates: Record<string, unknown>) => {
      // Payload-only: the dialog validates before save and emits the resolved
      // reviewReasons (advisories kept, hard resolved). No post-save recompute.
      const t0 = performance.now();
      setPendingTransactions((prev) => {
        if (!prev) return prev;
        return prev.map((t) => (t.id === id ? t.cloneWith(updates) : t));
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

  // Redirect to the dashboard if there is nothing to review once the session has resolved
  // (null or empty). This now covers the restored-tab / stale-deep-link case where
  // sessionStorage is gone: pendingTransactions seeds to [] and we leave instead of hanging.
  useEffect(() => {
    if (pendingTransactions !== null && pendingTransactions.length === 0) {
      router.push("/");
    }
  }, [pendingTransactions, router]);

  // Loading state: until mounted (SSR + hydration) and until the session has been seeded.
  if (!mounted || pendingTransactions === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
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
                  {unresolvedCount > 0 && (
                    <span className="text-amber-600 dark:text-amber-400 ml-2">
                      • {unresolvedCount} need{unresolvedCount === 1 ? "s" : ""} resolution
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
              <Button onClick={handleConfirmImport} disabled={unresolvedCount > 0}>
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
          <VerificationSummary report={verificationReport} currency={currency} flaggedCount={flaggedCount} />
        </div>
      )}

      {/* Transactions Table */}
      <div className="flex justify-center pb-4">
        <div className="w-[80vw] mx-auto pb-4">
          <div className="rounded-lg border">
            <Table className="text-base">
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
