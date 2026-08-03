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
import { cn } from "@/lib/utils";
import { type TransactionSubType, formatSubType, DEBIT_SUB_TYPES, CREDIT_SUB_TYPES } from "@/models/Transaction";
import { format } from "date-fns";
import { DEFAULT_CATEGORIES } from "@/lib/categorization/categories";
import { categoriesFor } from "@/lib/classification/subtypeCategories";
import { type ReviewReason, HARD_REASONS, REVIEW_REASONS, sortedForDisplay } from "@/lib/review/reviewReasons";
import {
  parseFormAmount,
  parseFormDate,
  dateInputBounds,
  computeDialogHardReasons,
  isFormDateValid,
} from "./reviewEditDialogCompanion";

const SORTED_CATEGORIES = (() => {
  const regular = DEFAULT_CATEGORIES
    .filter((c) => c.id !== "other")
    .sort((a, b) => a.name.localeCompare(b.name));
  const other = DEFAULT_CATEGORIES.find((c) => c.id === "other");
  return other ? [...regular, other] : regular;
})();

// Forced-classification reasons (spec §6.3 mechanism 2): the subtype/category are a
// guess, so the dialog presents them blank and gates Save on a dirty form. The
// underlying transaction retains its values — routing/roleOf never see a hole.
const FORCE_CLASSIFY: ReviewReason[] = ["subtype_inferred", "self_transfer_unresolved"];

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-background text-foreground px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

// Selects don't pick up aria-invalid automatically (unlike Input), so an invalid
// select gets the destructive border/ring added by hand to match the Input style.
const invalidSelectClass =
  "border-destructive ring-2 ring-destructive/30 focus-visible:ring-destructive/40";

// All confidence fields on Transaction are 0-1. Show as a rounded percent.
function confidencePct(v: number | undefined): string | null {
  return typeof v === "number" && isFinite(v) ? `${Math.round(v * 100)}%` : null;
}

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
  const [showAllReasons, setShowAllReasons] = useState(false);

  if (!transaction) return null;

  // Read from local edits first, fall back to original transaction
  const get = <T,>(field: string, fallback: T): T =>
    (field in edits ? edits[field] : fallback) as T;

  const currentType = get("type", transaction.type);
  const subtypes = currentType === "debit" ? DEBIT_SUB_TYPES : CREDIT_SUB_TYPES;

  // Forced classification (spec §6.3 mechanism 2). When the row carries a
  // classification-decision reason, the subtype/category are a guess and are
  // presented blank so the user must consciously pick. Blanking rides on the
  // get() fallback, so once the user edits the field their choice surfaces.
  const forceClassify = transaction.reviewReasons.some((r) => FORCE_CLASSIFY.includes(r));

  // M:N cascade (spec §3.2): offer only categories valid under the subtype.
  const currentSubType = get(
    "transactionSubType",
    forceClassify ? undefined : transaction.transactionSubType,
  );
  const allowedCategories = currentSubType ? categoriesFor(currentSubType) : SORTED_CATEGORIES;
  const currentCategoryRaw = get("category", forceClassify ? "" : transaction.category.id);
  const currentCategory = allowedCategories.some((c) => c.id === currentCategoryRaw)
    ? currentCategoryRaw
    : "";

  // Validate-before-save: recompute hard reasons against the live form state. Save
  // stays disabled while any hard reason remains; advisories are never touched here.
  // The logic lives in a pure helper (reviewEditDialogCompanion.ts) so it is unit-
  // testable independently of the React component.
  const hardReasons = computeDialogHardReasons({
    type: currentType === TransactionType.Credit ? "credit" : "debit",
    amount: get<number>("amount", transaction.amount),
    date: get<Date>("date", transaction.date),
    transactionSubType: currentSubType,
    categoryId: currentCategory,
    llmConfidence: transaction.llmConfidence,
    isForcedSelection: forceClassify,
    hasInferred: transaction.reviewReasons.includes("subtype_inferred"),
    hasSelfTransferUnresolved: transaction.reviewReasons.includes("self_transfer_unresolved"),
  });

  // Per-field validity drives the red-outline borders (decision 3: each field validates
  // itself — no reason→field mapping). Date reuses isFormDateValid so the border and the
  // Save gate agree on what a valid date is.
  const dateBounds = dateInputBounds();
  const liveAmount = get<number>("amount", transaction.amount);
  const liveDate = get<Date>("date", transaction.date);
  const amountFieldValid = typeof liveAmount === "number" && isFinite(liveAmount);
  const dateFieldValid = isFormDateValid(liveDate);
  const subtypeFieldValid = !!currentSubType;
  const categoryFieldValid = !!currentCategory;

  // The dialog is "dirty" only when the saved result would actually differ from the
  // stored transaction — a field reverted to its original value is not a change, so
  // the user cannot save-and-close without making a real change. Forced-classification
  // rows present subtype and category blank, so for those the act of picking both is
  // itself the change (it clears the classification reason), even if the picks match
  // the stored values.
  const fieldNetDiff =
    get<Date>("date", transaction.date).getTime() !== transaction.date.getTime() ||
    get<string>("description", transaction.description) !== transaction.description ||
    get<number>("amount", transaction.amount) !== transaction.amount ||
    currentType !== transaction.type ||
    (!forceClassify &&
      (currentSubType ?? undefined) !== (transaction.transactionSubType ?? undefined)) ||
    (!forceClassify && currentCategory !== transaction.category.id);
  const isDirty = fieldNetDiff || (forceClassify && !!currentSubType && !!currentCategory);

  // Banner = carried reasons, live-filtered (decision 2). Hard reasons present on the row
  // at open stay on the banner only while still unresolved against the live form; advisories
  // ride through. The set only ever shrinks during editing — it can never grow — so the
  // banner doesn't thrash. missing_or_invalid_field is dropped here: a per-field border
  // already signals it, and re-listing it is what caused the mid-edit flashing.
  const liveHard = new Set(hardReasons);
  const carriedHard = transaction.reviewReasons.filter(
    (r) => HARD_REASONS.has(r) && r !== "missing_or_invalid_field",
  );
  const advisoryReasons = transaction.reviewReasons.filter((r) => !HARD_REASONS.has(r));
  const bannerHard = carriedHard.filter((r) => liveHard.has(r));
  const bannerHasHard = bannerHard.length > 0;
  const allReasons = sortedForDisplay([...bannerHard, ...advisoryReasons]);
  const visibleReasons = showAllReasons ? allReasons : allReasons.slice(0, 2);
  const hiddenReasonCount = allReasons.length - visibleReasons.length;

  // Confidence readout: verification (extraction match) + category (categorization).
  // Read-only display of the stored values; not affected by in-flight edits.
  const confidenceParts: string[] = [];
  const verificationPct = confidencePct(transaction.verificationConfidence);
  if (verificationPct) confidenceParts.push(`Verification ${verificationPct}`);
  const categoryPct = confidencePct(transaction.categoryConfidence);
  if (categoryPct) confidenceParts.push(`Category ${categoryPct}`);
  const confidenceLine = confidenceParts.length > 0 ? confidenceParts.join(" · ") : null;

  const set = (updates: Record<string, unknown>) => {
    setEdits((prev) => ({ ...prev, ...updates }));
  };

  const handleSave = () => {
    // Dirty-form gate + validate-before-save (spec §6.3). The button is disabled
    // when either fails; this is a defense-in-depth guard.
    if (!isDirty || hardReasons.length > 0) return;

    const finalEdits: Record<string, unknown> = { ...edits };

    // Hard reasons are resolved (validated above). low_confidence is cleared too: it
    // concerns the row's own data, which this full-row review just resolved (spec §6.3).
    // fingerprint_collision is NOT row-fixable and persists. (Reconciliation failure is
    // statement-level and never lands on a row — see applyVerificationReviewReasons.)
    finalEdits.reviewReasons = transaction.reviewReasons.filter(
      (r) => !HARD_REASONS.has(r) && r !== "low_confidence",
    );

    // A category edit re-owns the categorization (categorizedBy=Manual is set in the
    // onChange). Drop the stale categorizer confidence so it cannot contradict a
    // user-confirmed category (and re-fire low_confidence on any future re-stamp).
    if ("category" in edits) {
      finalEdits.categoryConfidence = undefined;
    }

    // When the user confirmed an inferred subtype, clear the durable llmConfidence-0
    // marker so the row is no longer recorded as a guess (spec §3.4). Leaving 0 on a
    // user-chosen subtype would be a stale, dishonest signal.
    if (transaction.reviewReasons.includes("subtype_inferred") && "transactionSubType" in edits) {
      finalEdits.llmConfidence = undefined;
    }

    onSave(transaction.id, finalEdits);
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

        {confidenceLine && (
          <p className="text-xs text-muted-foreground">{confidenceLine}</p>
        )}

        {allReasons.length > 0 && (
          <div className="min-h-[3.5rem]">
            <div
              className={cn(
                "rounded-md border px-3 py-2 text-sm",
                bannerHasHard
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
              )}
            >
              <p className="font-medium mb-1">
                {bannerHasHard ? "Resolve before saving" : "Review notes"}
              </p>
              <ul className="space-y-1">
                {visibleReasons.map((r) => (
                  <li key={r} className="flex gap-2">
                    <span className={HARD_REASONS.has(r) ? "text-destructive" : "text-amber-600 dark:text-amber-400"}>●</span>
                    <span>
                      <span className="font-medium">{REVIEW_REASONS[r].label}</span>
                      <span className="opacity-70"> — {REVIEW_REASONS[r].hint}</span>
                    </span>
                  </li>
                ))}
              </ul>
              {/* The toggle stays mounted whenever there are more than two reasons —
                  collapsed shows "+N more", expanded shows "Show less". Gating on
                  hiddenReasonCount would unmount the button once expanded (it hits 0),
                  killing the collapse path. */}
              {allReasons.length > 2 && (
                <button
                  type="button"
                  onClick={() => setShowAllReasons((v) => !v)}
                  className="mt-1 text-xs underline opacity-70 hover:opacity-100"
                >
                  {showAllReasons ? "Show less" : `+${hiddenReasonCount} more`}
                </button>
              )}
            </div>
          </div>
        )}

        <div className="grid gap-4 py-4">
          {/* Date */}
          <div className="grid grid-cols-4 items-center gap-4">
            <label htmlFor="edit-date" className="text-right text-sm font-medium">Date</label>
            <Input
              id="edit-date"
              type="date"
              min={dateBounds.min}
              max={dateBounds.max}
              aria-invalid={!dateFieldValid}
              value={format(get("date", transaction.date), "yyyy-MM-dd")}
              onChange={(e) => {
                const parsed = parseFormDate(e.target.value);
                if (parsed) set({ date: parsed });
              }}
              className="col-span-3"
            />
          </div>

          {/* Description */}
          {/* FIXME: description is not validated. Clearing it is a no-op (not a required
              field). If it should be required, add it to computeDialogHardReasons and give
              the input an aria-invalid border like the other required fields. */}
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
              aria-invalid={!amountFieldValid}
              value={Math.abs(get("amount", transaction.amount))}
              onChange={(e) => {
                const parsed = parseFormAmount(e.target.value);
                if (parsed !== null) set({ amount: parsed });
              }}
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
                // A type change re-scopes both subtype (direction-bound) and category
                // (subtype-bound). Reset both so the user re-picks under the new type —
                // otherwise a stale subtype silently becomes direction-invalid.
                transactionSubType: undefined,
                category: "",
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
              value={currentSubType ?? ""}
              onChange={(e) => {
                const newSub = (e.target.value || undefined) as TransactionSubType | undefined;
                // A subtype change is a re-classification: the category is scoped to the
                // subtype (§3.2 M:N), so ALWAYS reset it and force a re-pick — not only when
                // the old category happens to be invalid under the new subtype.
                set({ transactionSubType: newSub, category: "" });
              }}
              className={`col-span-3 ${selectClass} ${!subtypeFieldValid ? invalidSelectClass : ""}`}
            >
              <option value="">— select —</option>
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
                categorizedBy: CategorizedBy.Manual,
              })}
              className={`col-span-3 ${selectClass} ${!categoryFieldValid ? invalidSelectClass : ""}`}
            >
              <option value="">— select —</option>
              {allowedCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!isDirty || hardReasons.length > 0}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
