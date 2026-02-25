"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CreditCard,
  CheckCircle2,
  Clock,
  TrendingUp,
  AlertTriangle,
  DollarSign,
} from "lucide-react";
import { useCreditCardStore } from "@/lib/store/creditCardStore";
import { useSettingsStore } from "@/lib/store/settingsStore";
import { formatCurrency } from "@/lib/currencyFormatter";
import { PaymentBehavior } from "@/types/creditCard";
import { format } from "date-fns";

/**
 * Payment Behavior Card
 *
 * Shows payment behavior insights:
 * - Full payment rate (% of statements paid in full)
 * - On-time payment rate (% paid before due date)
 * - Total interest paid
 * - Statement count
 */
export function PaymentBehaviorCard() {
  const getPaymentBehavior = useCreditCardStore((state) => state.getPaymentBehavior);
  const getAllUniqueCards = useCreditCardStore((state) => state.getAllUniqueCards);
  const currency = useSettingsStore((state) => state.currency);

  const [months, setMonths] = useState<string>("12");

  const hasCCData = getAllUniqueCards().length > 0;

  const behavior: PaymentBehavior | null = useMemo(() => {
    if (!hasCCData) return null;
    return getPaymentBehavior(parseInt(months));
  }, [hasCCData, getPaymentBehavior, months]);

  // Don't show if no CC data
  if (!hasCCData || !behavior) {
    return null;
  }

  const getRateColor = (rate: number): string => {
    if (rate >= 0.9) return "text-success";
    if (rate >= 0.7) return "text-blue-500";
    if (rate >= 0.5) return "text-amber-500";
    return "text-destructive";
  };

  const getRateLabel = (rate: number): string => {
    if (rate >= 0.9) return "Excellent";
    if (rate >= 0.7) return "Good";
    if (rate >= 0.5) return "Fair";
    return "Needs Improvement";
  };

  const fullPayPercent = Math.round(behavior.fullPayRate * 100);
  const onTimePercent = Math.round(behavior.onTimeRate * 100);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <CreditCard className="w-4 h-4 text-primary" />
            Payment Behavior
          </CardTitle>
          <Select value={months} onValueChange={setMonths}>
            <SelectTrigger className="w-[100px] h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3">3 months</SelectItem>
              <SelectItem value="6">6 months</SelectItem>
              <SelectItem value="12">12 months</SelectItem>
              <SelectItem value="24">24 months</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">
          {format(behavior.period.start, "MMM yyyy")} - {format(behavior.period.end, "MMM yyyy")}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Statement Count */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Statements Analyzed</span>
          <Badge variant="secondary">{behavior.statementCount}</Badge>
        </div>

        <Separator />

        {/* Full Payment Rate */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm">Full Payment Rate</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`font-medium ${getRateColor(behavior.fullPayRate)}`}>
                {fullPayPercent}%
              </span>
              <Badge variant="outline" className="text-xs">
                {getRateLabel(behavior.fullPayRate)}
              </Badge>
            </div>
          </div>
          <Progress value={fullPayPercent} className="h-2" />
          <p className="text-xs text-muted-foreground">
            Percentage of statements where you paid the full balance
          </p>
        </div>

        {/* On-time Payment Rate */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm">On-time Payment Rate</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`font-medium ${getRateColor(behavior.onTimeRate)}`}>
                {onTimePercent}%
              </span>
              <Badge variant="outline" className="text-xs">
                {getRateLabel(behavior.onTimeRate)}
              </Badge>
            </div>
          </div>
          <Progress value={onTimePercent} className="h-2" />
          <p className="text-xs text-muted-foreground">
            Percentage of payments made before the due date
          </p>
        </div>

        <Separator />

        {/* Total Interest Paid */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm">Total Interest Paid</span>
          </div>
          <span
            className={`font-mono font-medium ${
              behavior.totalInterestPaid > 0 ? "text-destructive" : "text-success"
            }`}
          >
            {formatCurrency(behavior.totalInterestPaid, currency)}
          </span>
        </div>

        {/* Warning if interest paid */}
        {behavior.totalInterestPaid > 0 && (
          <div className="flex items-start gap-2 text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/30 p-2 rounded">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Paying full balance each month avoids interest charges. Consider paying more than the minimum.
            </span>
          </div>
        )}

        {/* Success message if perfect behavior */}
        {behavior.fullPayRate === 1 && behavior.onTimeRate === 1 && (
          <div className="flex items-center gap-2 text-xs text-success bg-success/10 p-2 rounded">
            <TrendingUp className="w-4 h-4" />
            <span>
              Perfect payment record! Keep paying your full balance on time.
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
