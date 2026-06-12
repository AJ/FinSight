"use client";

import { memo } from "react";
import { Button } from "@/components/ui/button";
import {
  TableCell,
  TableRow,
} from "@/components/ui/table";
import { Edit2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Transaction } from "@/types";
import { formatSubType } from "@/models/Transaction";
import { Currency } from "@/types";
import { formatCurrency } from "@/lib/currencyFormatter";
import { format } from "date-fns";
import { CategoryBadge } from "@/components/transactions/CategoryBadge";
import { AlertTriangle } from "lucide-react";

interface ReviewTransactionRowProps {
  transaction: Transaction;
  currency: Currency;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

function ReviewTransactionRowInner({
  transaction,
  currency,
  onEdit,
  onDelete,
}: ReviewTransactionRowProps) {
  return (
    <TableRow
      className={cn(
        "border-b-2",
        transaction.isSuspense && "bg-amber-500/10 dark:bg-amber-500/10 border-amber-500/50",
        !transaction.isSuspense && transaction.verificationConfidence !== undefined &&
          transaction.verificationConfidence < 0.5 &&
          "border-orange-400 border-dashed",
        !transaction.isSuspense && transaction.verificationConfidence !== undefined &&
          transaction.verificationConfidence >= 0.5 &&
          transaction.verificationConfidence < 0.75 &&
          "border-yellow-400 border-dashed",
        !transaction.isSuspense && transaction.llmConfidence !== undefined &&
          transaction.verificationConfidence !== undefined &&
          Math.abs(transaction.llmConfidence - transaction.verificationConfidence) > 0.3 &&
          "border-red-400 border-dotted",
      )}
    >
      {/* Date */}
      <TableCell className="font-mono text-sm text-center">
        {format(transaction.date, "dd MMM yyyy")}
      </TableCell>

      {/* Description */}
      <TableCell>
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

      {/* Subtype */}
      <TableCell className="text-center">
        <span className="text-xs text-muted-foreground">
          {transaction.transactionSubType
            ? formatSubType(transaction.transactionSubType)
            : "-"}
        </span>
      </TableCell>

      {/* Category */}
      <TableCell className="text-center">
        <div className="flex items-center justify-center gap-1">
          {transaction.isSuspense ? (
            <button
              type="button"
              onClick={() => onEdit(transaction.id)}
              className="inline-flex items-center gap-1 rounded-full bg-amber-500 text-white hover:bg-amber-600 transition-colors text-xs px-2 py-1 font-medium"
            >
              <AlertTriangle className="w-3 h-3" />
              Set category
            </button>
          ) : (
            <CategoryBadge categoryId={transaction.category.id} />
          )}
        </div>
      </TableCell>

      {/* Actions */}
      <TableCell>
        <div className="flex gap-2">
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
