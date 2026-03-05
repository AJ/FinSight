"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FileText,
  Check,
  Clock,
  ChevronDown,
  ChevronUp,
  History,
} from "lucide-react";
import { useCreditCardStore } from "@/lib/store/creditCardStore";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { formatCurrency } from "@/lib/currencyFormatter";
import { format } from "date-fns";
import { CreditCardStatement } from "@/types/creditCard";

/** Ensure a value is a proper Date object */
function toDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v);
}

/**
 * Statement History Card
 *
 * Shows a list of all uploaded statements with payment status.
 * Allows marking statements as paid/unpaid.
 */
export function StatementHistoryCard() {
  const statements = useCreditCardStore((state) => state.statements);
  const markStatementPaid = useCreditCardStore((state) => state.markStatementPaid);
  const updateStatement = useCreditCardStore((state) => state.updateStatement);
  const currency = useSettingsStore((state) => state.currency);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

  // Group statements by card
  const statementsByCard = useMemo(() => {
    const groups = new Map<string, CreditCardStatement[]>();
    for (const stmt of statements) {
      const key = `${stmt.cardIssuer}-${stmt.cardLastFour}`;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(stmt);
    }
    // Sort each group by statement date descending
    for (const [, stmts] of groups) {
      stmts.sort((a, b) => toDate(b.statementDate).getTime() - toDate(a.statementDate).getTime());
    }
    return groups;
  }, [statements]);

  if (statements.length === 0) {
    return null;
  }

  const toggleExpanded = (cardKey: string) => {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(cardKey)) {
        next.delete(cardKey);
      } else {
        next.add(cardKey);
      }
      return next;
    });
  };

  const handleMarkPaid = (statementId: string, paid: boolean) => {
    if (paid) {
      markStatementPaid(statementId, new Date());
    } else {
      updateStatement(statementId, { isPaid: false, paidDate: undefined, paidAmount: undefined });
    }
  };

  // Calculate summary stats
  const totalStatements = statements.length;
  const paidStatements = statements.filter((s) => s.isPaid).length;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="w-4 h-4 text-primary" />
          Statement History
          <Badge variant="secondary" className="ml-auto text-xs">
            {paidStatements}/{totalStatements} Paid
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {Array.from(statementsByCard.entries()).map(([cardKey, cardStatements]) => {
          const [issuer, lastFour] = cardKey.split("-");
          const isExpanded = expandedCards.has(cardKey);
          const cardPaidCount = cardStatements.filter((s) => s.isPaid).length;

          return (
            <div key={cardKey} className="border rounded-lg overflow-hidden">
              {/* Card Header - Always visible */}
              <button
                onClick={() => toggleExpanded(cardKey)}
                className="w-full flex items-center justify-between p-3 bg-muted/30 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">
                    {issuer} ****{lastFour}
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {cardStatements.length} statements
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={cardPaidCount === cardStatements.length ? "secondary" : "outline"}
                    className="text-xs"
                  >
                    {cardPaidCount}/{cardStatements.length} Paid
                  </Badge>
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
              </button>

              {/* Statement List - Expandable */}
              {isExpanded && (
                <div className="divide-y">
                  {cardStatements.map((stmt) => (
                    <div
                      key={stmt.id}
                      className={`flex items-center justify-between p-3 border-l-2 ${
                        stmt.isPaid ? "bg-muted/30 border-l-success" : "border-l-transparent"
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="text-sm font-medium">
                          {format(toDate(stmt.statementDate), "MMM yyyy")}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Due: {format(toDate(stmt.paymentDueDate), "MMM dd, yyyy")}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="font-mono text-sm font-semibold">
                          {formatCurrency(stmt.totalDue, currency)}
                        </div>
                        {stmt.isPaid ? (
                          <Badge variant="secondary" className="text-xs">
                            <Check className="w-3 h-3 mr-1 text-success" />
                            Paid
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">
                            <Clock className="w-3 h-3 mr-1" />
                            Unpaid
                          </Badge>
                        )}
                        <div className="flex items-center gap-1 text-xs">
                          <span className="text-muted-foreground">Mark as</span>
                          <Button
                            size="sm"
                            variant={stmt.isPaid ? "default" : "outline"}
                            className="h-6 px-2 text-xs"
                            onClick={() => handleMarkPaid(stmt.id, !stmt.isPaid)}
                          >
                            {stmt.isPaid ? "Unpaid" : "Paid"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
