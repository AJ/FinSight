'use client';

import { useEffect, useState, useRef } from 'react';
import { useTransactionStore } from '@/lib/store/transactionStore';
import { useRecurringStore } from '@/lib/store/recurringStore';
import { useSettingsStore } from '@/lib/store/settingsStore';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { RecurringPaymentCard } from '@/components/recurring/RecurringPaymentCard';
import { formatCurrency } from '@/lib/currencyFormatter';
import { RefreshCw, AlertTriangle, CheckCircle, Filter, Upload } from 'lucide-react';
import { useUpload } from '@/components/layout/UploadContext';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type FilterOption = 'all' | 'active' | 'inactive';

export default function SubscriptionsPage() {
  const { openUpload } = useUpload();
  const currency = useSettingsStore((state) => state.currency);
  const transactions = useTransactionStore((state) => state.transactions);
  const recurringPayments = useRecurringStore((state) => state.recurringPayments);
  const isScanning = useRecurringStore((state) => state.isScanning);
  const scanTransactions = useRecurringStore((state) => state.scanTransactions);
  const getTotalMonthlyRecurring = useRecurringStore((state) => state.getTotalMonthlyRecurring);

  const [filter, setFilter] = useState<FilterOption>('all');
  const hasScannedRef = useRef(false);

  // Auto-scan on mount if we have transactions
  useEffect(() => {
    if (transactions.length > 0 && !hasScannedRef.current && !isScanning) {
      scanTransactions(transactions);
      hasScannedRef.current = true;
    }
  }, [transactions, isScanning, scanTransactions]);

  const activePayments = recurringPayments.filter(p => p.isActive);
  const inactivePayments = recurringPayments.filter(p => !p.isActive);
  const totalMonthly = getTotalMonthlyRecurring();

  // Apply filter
  let filteredPayments = recurringPayments;
  if (filter === 'active') {
    filteredPayments = activePayments;
  } else if (filter === 'inactive') {
    filteredPayments = inactivePayments;
  }

  if (transactions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4">No Data Yet</h2>
          <p className="text-muted-foreground mb-6">
            Upload your first statement to detect recurring payments
          </p>
          <Button onClick={openUpload}>
            <Upload className="w-4 h-4 mr-2" />
            Upload Statement
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Page Header */}
      <div className="border-b border-border bg-card">
        <div className="px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Recurring Payments</h1>
            <p className="text-sm text-muted-foreground">
              {recurringPayments.length} subscription{recurringPayments.length !== 1 ? 's' : ''} •{' '}
              {formatCurrency(totalMonthly, currency, false)}/month total
            </p>
          </div>

          <Button
            variant="outline"
            onClick={() => scanTransactions(transactions)}
            disabled={isScanning}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isScanning ? 'animate-spin' : ''}`} />
            Rescan
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="p-6">
        {/* Summary Cards */}
        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-primary/10 rounded-lg">
                  <RefreshCw className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Monthly Total</p>
                  <p className="text-2xl font-bold">
                    {formatCurrency(totalMonthly, currency, false)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-success/10 rounded-lg">
                  <CheckCircle className="w-6 h-6 text-success" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Active</p>
                  <p className="text-2xl font-bold">{activePayments.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className={`p-3 rounded-lg ${inactivePayments.length > 0 ? 'bg-amber-500/10' : 'bg-muted/50'}`}>
                  <AlertTriangle className={`w-6 h-6 ${inactivePayments.length > 0 ? 'text-amber-500' : 'text-muted-foreground'}`} />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Possibly Cancelled</p>
                  <p className={`text-2xl font-bold ${inactivePayments.length > 0 ? 'text-amber-500' : ''}`}>
                    {inactivePayments.length}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filter */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <Select value={filter} onValueChange={(v) => setFilter(v as FilterOption)}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Filter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All ({recurringPayments.length})</SelectItem>
                <SelectItem value="active">Active ({activePayments.length})</SelectItem>
                <SelectItem value="inactive">Inactive ({inactivePayments.length})</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Loading State */}
        {isScanning && (
          <div className="text-center py-12">
            <RefreshCw className="w-8 h-8 mx-auto mb-4 animate-spin text-muted-foreground" />
            <p className="text-muted-foreground">Scanning transactions for recurring patterns...</p>
          </div>
        )}

        {/* Empty State */}
        {!isScanning && filteredPayments.length === 0 && (
          <div className="text-center py-12">
            <RefreshCw className="w-8 h-8 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold mb-2">No recurring payments detected</h3>
            <p className="text-muted-foreground max-w-md mx-auto">
              {filter !== 'all'
                ? `No ${filter} subscriptions found. Try changing the filter.`
                : 'Add more transaction history for better detection, or check if your subscriptions have consistent payment patterns.'}
            </p>
          </div>
        )}

        {/* Payment Lists */}
        {!isScanning && filteredPayments.length > 0 && (
          <div className="space-y-8">
            {/* Active Section */}
            {filter !== 'inactive' && activePayments.length > 0 && (
              <div>
                {filter === 'all' && (
                  <div className="flex items-center gap-2 mb-4">
                    <CheckCircle className="w-5 h-5 text-success" />
                    <h2 className="text-lg font-semibold">Active ({activePayments.length})</h2>
                  </div>
                )}
                <div className="space-y-4">
                  {(filter === 'all' ? activePayments : activePayments)
                    .map((payment) => (
                      <RecurringPaymentCard key={payment.id} payment={payment} />
                    ))}
                </div>
              </div>
            )}

            {/* Inactive Section */}
            {filter !== 'active' && inactivePayments.length > 0 && (
              <div>
                {filter === 'all' && (
                  <div className="flex items-center gap-2 mb-4">
                    <AlertTriangle className="w-5 h-5 text-amber-500" />
                    <h2 className="text-lg font-semibold">Possibly Cancelled ({inactivePayments.length})</h2>
                  </div>
                )}
                <div className="space-y-4">
                  {(filter === 'all' ? inactivePayments : inactivePayments)
                    .map((payment) => (
                      <RecurringPaymentCard key={payment.id} payment={payment} />
                    ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
