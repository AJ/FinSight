"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Transaction, TransactionType, CategorizedBy } from "@/types";
import type { TransactionSubType } from "@/models/Transaction";
import { formatSubType } from "@/models/Transaction";
import { format } from "date-fns";
import { DEFAULT_CATEGORIES } from "@/lib/categorization/categories";

const SORTED_CATEGORIES = (() => {
  const regular = DEFAULT_CATEGORIES
    .filter((c) => c.id !== "other")
    .sort((a, b) => a.name.localeCompare(b.name));
  const other = DEFAULT_CATEGORIES.find((c) => c.id === "other");
  return other ? [...regular, other] : regular;
})();

const DEBIT_SUBTYPES = ["purchase", "fee", "tax", "interest", "charge", "adjustment"] as const;
const CREDIT_SUBTYPES = ["payment", "refund", "cashback", "reversal", "adjustment"] as const;

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-background text-foreground px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

interface ReviewEditDialogProps {
  transaction: Transaction | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (id: string, updates: Record<string, unknown>) => void;
}

export function ReviewEditDialog({
  transaction,
  open,
  onOpenChange,
  onSave,
}: ReviewEditDialogProps) {
  // Local working state — only flushed to parent on Save.
  // Parent resets this via key={editingId}, so no manual reset needed.
  const [edits, setEdits] = useState<Record<string, unknown>>({});

  if (!transaction) return null;

  // Read from local edits first, fall back to original transaction
  const get = <T,>(field: string, fallback: T): T =>
    (field in edits ? edits[field] : fallback) as T;

  const currentType = get("type", transaction.type);
  const currentCategory = get("category", transaction.category.id);
  const subtypes = currentType === "debit" ? DEBIT_SUBTYPES : CREDIT_SUBTYPES;

  const set = (updates: Record<string, unknown>) => {
    setEdits((prev) => ({ ...prev, ...updates }));
  };

  const handleSave = () => {
    if (Object.keys(edits).length > 0) {
      onSave(transaction.id, edits);
    }
    setEdits({});
    onOpenChange(false);
  };

  const handleCancel = () => {
    setEdits({});
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleCancel(); }}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Edit Transaction</DialogTitle>
          <DialogDescription className="sr-only">Edit transaction fields</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Date */}
          <div className="grid grid-cols-4 items-center gap-4">
            <label htmlFor="edit-date" className="text-right text-sm font-medium">Date</label>
            <Input
              id="edit-date"
              type="date"
              value={format(get("date", transaction.date), "yyyy-MM-dd")}
              onChange={(e) => set({ date: new Date(e.target.value) })}
              className="col-span-3"
            />
          </div>

          {/* Description */}
          <div className="grid grid-cols-4 items-center gap-4">
            <label htmlFor="edit-desc" className="text-right text-sm font-medium">Description</label>
            <Input
              id="edit-desc"
              value={get("description", transaction.description)}
              onChange={(e) => set({ description: e.target.value })}
              className="col-span-3"
            />
          </div>

          {/* Amount */}
          <div className="grid grid-cols-4 items-center gap-4">
            <label htmlFor="edit-amount" className="text-right text-sm font-medium">Amount</label>
            <Input
              id="edit-amount"
              type="number"
              value={Math.abs(get("amount", transaction.amount))}
              onChange={(e) => set({ amount: parseFloat(e.target.value) })}
              className="col-span-3"
            />
          </div>

          {/* Type */}
          <div className="grid grid-cols-4 items-center gap-4">
            <label htmlFor="edit-type" className="text-right text-sm font-medium">Type</label>
            <select
              id="edit-type"
              value={currentType}
              onChange={(e) => set({
                type: e.target.value === "credit" ? TransactionType.Credit : TransactionType.Debit,
              })}
              className={`col-span-3 ${selectClass}`}
            >
              <option value="credit">Credit</option>
              <option value="debit">Debit</option>
            </select>
          </div>

          {/* Subtype */}
          <div className="grid grid-cols-4 items-center gap-4">
            <label htmlFor="edit-subtype" className="text-right text-sm font-medium">Subtype</label>
            <select
              id="edit-subtype"
              value={get("transactionSubType", transaction.transactionSubType ?? "")}
              onChange={(e) => set({
                transactionSubType: (e.target.value || undefined) as TransactionSubType | undefined,
              })}
              className={`col-span-3 ${selectClass}`}
            >
              <option value="">— none —</option>
              {subtypes.map((st) => (
                <option key={st} value={st}>
                  {formatSubType(st)}
                </option>
              ))}
            </select>
          </div>

          {/* Category */}
          <div className="grid grid-cols-4 items-center gap-4">
            <label htmlFor="edit-category" className="text-right text-sm font-medium">Category</label>
            <select
              id="edit-category"
              value={currentCategory}
              onChange={(e) => set({
                category: e.target.value,
                needsReview: false,
                categorizedBy: CategorizedBy.Manual,
              })}
              className={`col-span-3 ${selectClass}`}
            >
              {SORTED_CATEGORIES.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={Object.keys(edits).length === 0}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
