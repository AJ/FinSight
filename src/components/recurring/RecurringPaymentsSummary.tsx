'use client';

import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useRecurringStore } from '@/lib/store/recurringStore';
import { useSettingsStore } from '@/lib/store/settingsStore';
import { useTransactionStore } from '@/lib/store/transactionStore';
import { formatCurrency } from '@/lib/currencyFormatter';
import { RefreshCw, AlertTriangle, ChevronRight } from 'lucide-react';
import { useEffect, useRef } from 'react';

export function RecurringPaymentsSummary() {
  const router = useRouter();
  const currency = useSettingsStore((state) => state.currency);
  const transactions = useTransactionStore((state) => state.transactions);
  const recurringPayments = useRecurringStore((state) => state.recurringPayments);
  const lastScanned = useRecurringStore((state) => state.lastScanned);
  const isScanning = useRecurringStore((state) => state.isScanning);
  const scanTransactions = useRecurringStore((state) => state.scanTransactions);
  const getTotalMonthlyRecurring = useRecurringStore((state) => state.getTotalMonthlyRecurring);

  const hasScannedRef = useRef(false);

  // Auto-scan on mount if we have transactions but no scan
  useEffect(() => {
    if (transactions.length > 0 && !hasScannedRef.current && !isScanning) {
      const shouldScan = !lastScanned ||
        new Date().getTime() - new Date(lastScanned).getTime() > 24 * 60 * 60 * 1000; // Re-scan after 24h

      if (shouldScan || recurringPayments.length === 0) {
        scanTransactions(transactions);
      }
      hasScannedRef.current = true;
    }
  }, [transactions, isScanning, lastScanned, recurringPayments.length, scanTransactions]);

  const activePayments = recurringPayments.filter(p => p.isActive);
  const inactivePayments = recurringPayments.filter(p => !p.isActive);
  const totalMonthly = getTotalMonthlyRecurring();

  if (transactions.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-primary" />
            <h3 className="font-semibold">Recurring Payments</h3>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => scanTransactions(transactions)}
            disabled={isScanning}
            className="h-8"
          >
            <RefreshCw className={`w-4 h-4 mr-1 ${isScanning ? 'animate-spin' : ''}`} />
            Rescan
          </Button>
        </div>

        <div className="space-y-3">
          {recurringPayments.length === 0 && !isScanning ? (
            <p className="text-sm text-muted-foreground">
              No recurring payments detected. Add more transaction history for better detection.
            </p>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold">
                  {formatCurrency(totalMonthly, currency, false)}
                </span>
                <span className="text-sm text-muted-foreground">/month</span>
                <span className="text-sm text-muted-foreground">
                  across {activePayments.length} subscription{activePayments.length !== 1 ? 's' : ''}
                </span>
              </div>

              {inactivePayments.length > 0 && (
                <div className="flex items-center gap-2 text-amber-500 text-sm">
                  <AlertTriangle className="w-4 h-4" />
                  <span>
                    {inactivePayments.length} possibly cancelled
                  </span>
                </div>
              )}

              <Button
                variant="outline"
                size="sm"
                className="w-full mt-2"
                onClick={() => router.push('/subscriptions')}
              >
                View All
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </>
          )}

          {isScanning && (
            <p className="text-sm text-muted-foreground animate-pulse">
              Scanning transactions...
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
