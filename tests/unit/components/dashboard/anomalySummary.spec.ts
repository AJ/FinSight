import { describe, it, expect } from 'vitest';
import { AnomalyType } from '@/types';
import {
  filterActiveAnomalies,
  countAnomaliesByType,
  type AnomalyLike,
} from '@/components/dashboard/anomalySummary';

function anomaly(overrides: Partial<AnomalyLike> = {}): AnomalyLike {
  return {
    isAnomaly: true,
    anomalyDismissed: false,
    anomalyTypes: [AnomalyType.HighAmount],
    ...overrides,
  };
}

describe('filterActiveAnomalies', () => {
  it('keeps anomalies that are not dismissed', () => {
    const txns = [
      anomaly({ isAnomaly: true, anomalyDismissed: false }),
      anomaly({ isAnomaly: true, anomalyDismissed: true }),
      anomaly({ isAnomaly: false, anomalyDismissed: false }),
    ];

    const result = filterActiveAnomalies(txns);
    expect(result).toHaveLength(1);
  });

  it('returns empty when no anomalies exist', () => {
    const txns = [
      anomaly({ isAnomaly: false }),
      anomaly({ isAnomaly: false }),
    ];

    expect(filterActiveAnomalies(txns)).toHaveLength(0);
  });

  it('returns empty when all anomalies are dismissed', () => {
    const txns = [
      anomaly({ isAnomaly: true, anomalyDismissed: true }),
      anomaly({ isAnomaly: true, anomalyDismissed: true }),
    ];

    expect(filterActiveAnomalies(txns)).toHaveLength(0);
  });

  it('handles undefined fields', () => {
    const txns = [
      { isAnomaly: true },
      { anomalyDismissed: false },
      {},
    ];

    const result = filterActiveAnomalies(txns as AnomalyLike[]);
    expect(result).toHaveLength(1);
  });

  it('returns empty for empty input', () => {
    expect(filterActiveAnomalies([])).toEqual([]);
  });
});

describe('countAnomaliesByType', () => {
  it('counts anomaly types across transactions', () => {
    const txns = [
      anomaly({ anomalyTypes: [AnomalyType.HighAmount, AnomalyType.UnusualFrequency] }),
      anomaly({ anomalyTypes: [AnomalyType.HighAmount] }),
    ];

    const result = countAnomaliesByType(txns);
    expect(result[AnomalyType.HighAmount]).toBe(2);
    expect(result[AnomalyType.UnusualFrequency]).toBe(1);
  });

  it('returns empty object for no anomaly types', () => {
    const txns = [
      anomaly({ anomalyTypes: undefined }),
      anomaly({ anomalyTypes: [] }),
    ];

    expect(countAnomaliesByType(txns)).toEqual({});
  });

  it('returns empty object for empty input', () => {
    expect(countAnomaliesByType([])).toEqual({});
  });

  it('handles single transaction with multiple types', () => {
    const txns = [
      anomaly({ anomalyTypes: [AnomalyType.HighAmount, AnomalyType.UnusualFrequency, AnomalyType.Duplicate] }),
    ];

    const result = countAnomaliesByType(txns);
    expect(Object.keys(result)).toHaveLength(3);
    expect(result[AnomalyType.HighAmount]).toBe(1);
    expect(result[AnomalyType.UnusualFrequency]).toBe(1);
    expect(result[AnomalyType.Duplicate]).toBe(1);
  });
});
