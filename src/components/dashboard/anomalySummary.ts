export interface AnomalyLike {
  isAnomaly?: boolean;
  anomalyDismissed?: boolean;
  anomalyTypes?: string[];
}

export function filterActiveAnomalies(transactions: AnomalyLike[]): AnomalyLike[] {
  return transactions.filter(
    (t) => t.isAnomaly && !t.anomalyDismissed,
  );
}

export function countAnomaliesByType(transactions: AnomalyLike[]): Record<string, number> {
  return transactions.reduce((acc, t) => {
    t.anomalyTypes?.forEach((type) => {
      acc[type] = (acc[type] || 0) + 1;
    });
    return acc;
  }, {} as Record<string, number>);
}
