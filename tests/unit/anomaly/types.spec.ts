import { describe, it, expect } from 'vitest';
import { ANOMALY_CONFIG, ANOMALY_LABELS, type AnomalyType } from '@/lib/anomaly/types';

describe('ANOMALY_CONFIG', () => {
  it('has all required fields', () => {
    expect(ANOMALY_CONFIG.amountStdDevThreshold).toBe(2.5);
    expect(ANOMALY_CONFIG.minTransactionsForStats).toBe(5);
    expect(ANOMALY_CONFIG.duplicateMerchantSimilarity).toBe(0.8);
    expect(ANOMALY_CONFIG.duplicateWindowHours).toBe(48);
    expect(ANOMALY_CONFIG.frequencyThreshold24h).toBe(3);
    expect(ANOMALY_CONFIG.frequencyThreshold7d).toBe(5);
  });
});

describe('ANOMALY_LABELS', () => {
  it('has labels for all anomaly types', () => {
    const types: AnomalyType[] = ['high_amount', 'low_amount', 'duplicate', 'unusual_frequency'];
    for (const type of types) {
      expect(ANOMALY_LABELS[type]).toBeDefined();
      expect(typeof ANOMALY_LABELS[type]).toBe('string');
    }
  });
});
