'use client';

import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useTransactionStore } from '@/lib/store/transactionStore';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import { AnomalyType } from '@/types';
import { ANOMALY_LABELS } from '@/lib/anomaly';

export function AnomalySummaryCard() {
  const router = useRouter();
  const transactions = useTransactionStore((state) => state.transactions);

  // Filter active anomalies (not dismissed)
  const activeAnomalies = transactions.filter(
    (t) => t.isAnomaly && !t.anomalyDismissed
  );

  // Don't render if no anomalies
  if (activeAnomalies.length === 0) return null;

  // Count by type
  const typeCounts = activeAnomalies.reduce((acc, t) => {
    t.anomalyTypes?.forEach((type) => {
      acc[type] = (acc[type] || 0) + 1;
    });
    return acc;
  }, {} as Record<AnomalyType, number>);

  return (
    <Card className="border-amber-500/20 bg-amber-500/5">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          <h3 className="font-semibold text-amber-600">Anomalies Detected</h3>
        </div>

        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {activeAnomalies.length} unusual transaction{activeAnomalies.length !== 1 ? 's' : ''} need review
          </p>

          <ul className="text-sm space-y-1">
            {Object.entries(typeCounts).map(([type, count]) => (
              <li key={type} className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                {count} {ANOMALY_LABELS[type as AnomalyType]}
                {count !== 1 ? 's' : ''}
              </li>
            ))}
          </ul>

          <Button
            variant="outline"
            size="sm"
            className="w-full mt-2"
            onClick={() => router.push('/transactions?anomaly=true')}
          >
            Review
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
