"use client";

import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, Check } from "lucide-react";
import { useCreditCardStore } from "@/lib/store/creditCardStore";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { formatCurrency } from "@/lib/currencyFormatter";
import { getAPRForIssuer } from "@/lib/creditCard/constants";
import { CreditCardStatement } from "@/types/creditCard";

interface CreditCardDisplayProps {
  cardIssuer: string;
  cardLastFour: string;
  statement: CreditCardStatement;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatPeriod(start: Date, end: Date): string {
  const startStr = new Intl.DateTimeFormat("en-IN", {
    month: "short",
    day: "numeric",
  }).format(start);
  const endStr = new Intl.DateTimeFormat("en-IN", {
    month: "short",
    day: "numeric",
  }).format(end);
  return `${startStr} – ${endStr}`;
}

function getDaysUntilDue(dueDate: Date): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  return Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export function CreditCardDisplay({
  cardIssuer,
  cardLastFour,
  statement,
}: CreditCardDisplayProps) {
  const [isOpen, setIsOpen] = useState(false);
  const currency = useSettingsStore((state) => state.currency);
  const markStatementPaid = useCreditCardStore((state) => state.markStatementPaid);

  const dueDate = new Date(statement.paymentDueDate);
  const daysUntilDue = getDaysUntilDue(dueDate);
  const isPaid = statement.isPaid;
  const isOverdue = daysUntilDue < 0 && !isPaid;
  const isDueSoon = daysUntilDue >= 0 && daysUntilDue <= 7;

  // Determine due date styling
  const getDueDateColor = () => {
    if (isPaid) return "text-success";
    if (isOverdue) return "text-destructive";
    if (isDueSoon) return "text-warning";
    return "text-success";
  };

  const getDueDateText = () => {
    if (isPaid) return "Paid";
    if (isOverdue) {
      return `${formatDate(dueDate)} · ${Math.abs(daysUntilDue)} days overdue`;
    }
    if (daysUntilDue === 0) {
      return "Today";
    }
    if (daysUntilDue === 1) {
      return "Tomorrow";
    }
    return `${formatDate(dueDate)} · ${daysUntilDue} days`;
  };

  // Card border styling based on status
  const getCardBorderClass = () => {
    if (isPaid) return "";
    if (isOverdue) return "border-destructive";
    if (isDueSoon) return "border-warning";
    return "";
  };

  // APR display
  const apr = statement.apr ?? getAPRForIssuer(cardIssuer);
  const aprDisplay = apr ? `${(apr * 100).toFixed(1)}% p.a.` : "not in stmt";

  // Rewards or Cashback display
  
  const rewardsDisplay = statement.rewardPoints && statement.rewardPoints.closingBalance != null
    ? `${statement.rewardPoints.closingBalance.toLocaleString()} pts`
    : statement.cashbackEarned
    ? formatCurrency(statement.cashbackEarned, currency)
    : "not in stmt";

  const handleMarkPaid = () => {
    markStatementPaid(statement.id, new Date(), statement.totalDue);
  };

  return (
    <Card
      className={`cursor-pointer transition-all hover:border-primary ${getCardBorderClass()}`}
    >
      <CardContent className="p-4">
        {/* Header: Bank, Card Name, Last 4 */}
        <div
          className="flex justify-between items-start mb-3"
          onClick={() => setIsOpen(!isOpen)}
        >
          <div>
            <div className="text-sm font-semibold">{cardIssuer}</div>
            {statement.cardHolder && (
              <div className="text-xs text-muted-foreground">{statement.cardHolder}</div>
            )}
          </div>
          <div className="text-xs text-muted-foreground font-mono">
            ●●●● {cardLastFour}
          </div>
        </div>

        {/* Main: Amount Due and Due Date */}
        <div
          className="flex justify-between items-end mb-3 pb-3 border-b border-border"
          onClick={() => setIsOpen(!isOpen)}
        >
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
              Amount Due
            </div>
            <div className="text-xl font-bold">
              {isPaid ? (
                <span className="text-success line-through">
                  {formatCurrency(statement.totalDue, currency)}
                </span>
              ) : (
                formatCurrency(statement.totalDue, currency)
              )}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-muted-foreground">Due Date</div>
            <div className={`text-sm font-semibold ${getDueDateColor()}`}>
              {getDueDateText()}
            </div>
          </div>
        </div>

        {/* Footer: Min Payment, Credit Limit */}
        <div
          className="flex justify-between text-xs text-muted-foreground mb-2"
          onClick={() => setIsOpen(!isOpen)}
        >
          <div>Min: {formatCurrency(statement.minimumDue, currency)}</div>
          <div>Limit: {formatCurrency(statement.creditLimit, currency)}</div>
        </div>

        {/* Mark as Paid button - only show if not paid and has due amount */}
        {!isPaid && statement.totalDue > 0 && (
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                handleMarkPaid();
              }}
            >
              <Check className="w-3 h-3 mr-1" />
              Mark Paid
            </Button>
          </div>
        )}

        {/* Expanded Details */}
        {isOpen && (
          <div
            className="mt-3 pt-3 border-t border-border grid grid-cols-3 gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <div className="text-[10px] text-muted-foreground uppercase">APR</div>
              <div className="text-sm font-semibold">{aprDisplay}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase">
                {statement.rewardPoints ? "Rewards" : statement.cashbackEarned ? "Cashback" : "Rewards"}
              </div>
              <div className="text-sm font-semibold">{rewardsDisplay}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase">Stmt Period</div>
              <div className="text-sm font-semibold">
                {formatPeriod(
                  new Date(statement.statementPeriod.start),
                  new Date(statement.statementPeriod.end)
                )}
              </div>
            </div>
          </div>
        )}

        {/* Expand indicator */}
        <div
          className="flex justify-center mt-2 cursor-pointer"
          onClick={() => setIsOpen(!isOpen)}
        >
          {isOpen ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Cards Grid - displays all credit cards in a responsive grid
 */
export function CreditCardsGrid() {
  const getAllUniqueCards = useCreditCardStore((state) => state.getAllUniqueCards);
  const getMostRecentStatement = useCreditCardStore((state) => state.getMostRecentStatement);
  // Subscribe to statements to trigger re-renders when they change (e.g., isPaid updates)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _statements = useCreditCardStore((state) => state.statements);

  const uniqueCards = useMemo(() => getAllUniqueCards(), [getAllUniqueCards]);

  if (uniqueCards.length === 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {uniqueCards.map((card) => {
        const recentStatement = getMostRecentStatement(card.cardIssuer, card.cardLastFour);
        if (!recentStatement) return null;

        return (
          <CreditCardDisplay
            key={`${card.cardIssuer}-${card.cardLastFour}`}
            cardIssuer={card.cardIssuer}
            cardLastFour={card.cardLastFour}
            statement={recentStatement}
          />
        );
      })}
    </div>
  );
}
