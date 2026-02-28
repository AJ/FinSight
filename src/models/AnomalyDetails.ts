import { FrequencyPeriod } from './FrequencyPeriod';

/**
 * Details about why a transaction was flagged as an anomaly.
 */
export interface AnomalyDetails {
  amountDeviation?: number;
  duplicateOf?: string;
  frequencyCount?: number;
  frequencyPeriod?: FrequencyPeriod;
}
