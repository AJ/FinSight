"use client";

import { memo } from "react";
import { Button } from "@/components/ui/button";
import {
  TableCell,
  TableRow,
} from "@/components/ui/table";
import { Edit2, Trash2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Transaction } from "@/types";
import { formatSubType } from "@/models/Transaction";
import { Currency } from "@/types";
import { formatCurrency } from "@/lib/currencyFormatter";
import { formatDate } from "@/lib/dateFormatter";
import { CategoryBadge } from "@/components/transactions/CategoryBadge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  hasHardReason,
  HARD_REASONS,
  REVIEW_REASONS,
  sortedForDisplay,
  type ReviewReason,
} from "@/lib/review/reviewReasons";

// All confidence fields on Transaction are 0-1. Show as a rounded percent.
function confidencePct(v: number | undefined): string | null {
  return typeof v === "number" && isFinite(v) ? `${Math.round(v * 100)}%` : null;
}

// Unified grading for any confidence value, used by both the tooltip text and the row
// border: green ≥85% (not flagged), amber 50–85% (flagged low), red <50% (really low).
// 85 is the review flag threshold (VERIFICATION_FLAG_THRESHOLD), so green cleanly means
// "not flagged". One scale everywhere — the value's color never disagrees with the border.
function confidenceColor(v: number | undefined): string {
  if (typeof v !== "number" || !isFinite(v)) return "";
  if (v >= 0.85) return "text-emerald-600 dark:text-emerald-400";
  if (v >= 0.5) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

interface ReviewTransactionRowProps {
  transaction: Transaction;
  currency: Currency;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

// Hard reasons that concern the subtype or category. When a row carries any of them,
// both the subtype and category cells are blanked — the values are untrustworthy
// (a guess or a conflict) and the user must re-pick them in the edit dialog. Blanked
// uniformly, not per-reason: which specific cell is wrong isn't worth tracking.
const SUBTYPE_CATEGORY_REASONS: ReadonlySet<ReviewReason> = new Set([
  "subtype_direction_mismatch",
  "subtype_inferred",
  "invalid_subtype_category",
  "self_transfer_unresolved",
]);

function ReviewTransactionRowInner({
  transaction,
  currency,
  onEdit,
  onDelete,
}: ReviewTransactionRowProps) {
  const hasIssues = transaction.reviewReasons.length > 0;
  const hasHard = hasHardReason(transaction.reviewReasons);
  const blankCells = transaction.reviewReasons.some((r) =>
    SUBTYPE_CATEGORY_REASONS.has(r),
  );

  // The status indicator (Actions column) carries every reason in its tooltip.
  const sortedReasons = sortedForDisplay(transaction.reviewReasons);

  // Confidence readout for the tooltip header. Category confidence is suppressed when the row
  // is classification-blocked (blankCells): those reasons blank the subtype/category as
  // untrustworthy, so advertising "Category 99%" while forcing the user to re-pick it is
  // contradictory. Verification confidence is about extraction matching, not classification,
  // so it stays — and is now always present for scored rows (rejected rows keep their low
  // score), so the tooltip shows the verification failure that flagged the row.
  const verificationPct = confidencePct(transaction.verificationConfidence);
  const categoryPct = !blankCells ? confidencePct(transaction.categoryConfidence) : null;
  const hasConfidence = !!verificationPct || !!categoryPct;

  return (
    <TableRow
      className={cn(
        "border-b-2",
        hasHard && "bg-amber-500/10 dark:bg-amber-500/10 border-amber-500/50",
        // Verification-confidence grading, same scale as the tooltip (confidenceColor).
        // Only on non-hard rows — hard reasons already get the amber background above.
        !hasHard && transaction.verificationConfidence !== undefined &&
          transaction.verificationConfidence < 0.5 &&
          "border-red-400 border-dashed",
        !hasHard && transaction.verificationConfidence !== undefined &&
          transaction.verificationConfidence >= 0.5 &&
          transaction.verificationConfidence < 0.85 &&
          "border-amber-400 border-dashed",
      )}
    >
      {/* Date */}
      <TableCell className="font-mono text-center">
        {formatDate(transaction.date)}
      </TableCell>

      {/* Description */}
      <TableCell>
        <div className="min-w-0 break-words">
          <div className="font-medium line-clamp-2">
            {transaction.merchant || transaction.description}
          </div>
          {transaction.merchant && (
            <div className="text-sm text-muted-foreground line-clamp-2">
              {transaction.description}
            </div>
          )}
        </div>
      </TableCell>

      {/* Amount */}
      <TableCell className="text-right pr-2">
        <span
          className={`font-mono font-semibold ${
            transaction.isCredit
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-rose-600 dark:text-rose-400"
          }`}
        >
          {formatCurrency(transaction.signedAmount, currency)}
        </span>
      </TableCell>

      {/* Type */}
      <TableCell className="text-center">
        <Badge
          className={
            transaction.isCredit
              ? "bg-emerald-500 text-white hover:bg-emerald-600"
              : "bg-slate-500 text-white hover:bg-slate-600"
          }
        >
          {transaction.isCredit ? "Credit" : "Debit"}
        </Badge>
      </TableCell>

      {/* Subtype + Category — when the row has a subtype/category hard reason, the values
          are untrustworthy (a guess or a conflict). Merge the two columns into one cell with
          a single CTA; once the user picks valid values the reason clears and the cells split
          back into the subtype value + category badge below. */}
      {blankCells ? (
        <TableCell colSpan={2} className="text-center">
          <div className="flex items-center justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onEdit(transaction.id)}
              className="border-amber-500/50 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-300"
            >
              Select Subtype / Category
            </Button>
          </div>
        </TableCell>
      ) : (
        <>
          <TableCell className="text-center">
            <span className="text-sm text-muted-foreground">
              {transaction.transactionSubType
                ? formatSubType(transaction.transactionSubType)
                : ""}
            </span>
          </TableCell>
          <TableCell className="text-center">
            <div className="flex items-center justify-center">
              <CategoryBadge categoryId={transaction.category.id} />
            </div>
          </TableCell>
        </>
      )}

      {/* Actions */}
      <TableCell>
        <div className="flex items-center gap-2">
          {hasIssues && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    role="img"
                    aria-label={`Review issues — ${sortedReasons.map((r) => REVIEW_REASONS[r].label).join("; ")}`}
                    className={hasHard ? "text-red-500" : "text-amber-500"}
                  >
                    <TriangleAlert className="w-[18px] h-[18px]" strokeWidth={2.25} />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {hasConfidence && (
                    <div className="mb-1 flex gap-3 font-medium">
                      {verificationPct && (
                        <span className={confidenceColor(transaction.verificationConfidence)}>
                          Verification {verificationPct}
                        </span>
                      )}
                      {categoryPct && (
                        <span className={confidenceColor(transaction.categoryConfidence)}>
                          Category {categoryPct}
                        </span>
                      )}
                    </div>
                  )}
                  <ul className="space-y-1">
                    {sortedReasons.map((r) => (
                      <li key={r} className="flex gap-1.5">
                        <span
                          className={cn(
                            "mt-0.5",
                            HARD_REASONS.has(r) ? "text-red-500" : "text-amber-500",
                          )}
                        >
                          ●
                        </span>
                        <span className="min-w-0 break-words">
                          <span className="font-medium">{REVIEW_REASONS[r].label}</span>
                          <span className="opacity-70"> — {REVIEW_REASONS[r].hint}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onEdit(transaction.id)}
          >
            <Edit2 className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onDelete(transaction.id)}
          >
            <Trash2 className="w-4 h-4 text-destructive" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

export const ReviewTransactionRow = memo(ReviewTransactionRowInner);
