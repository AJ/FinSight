/**
 * Types of anomalies that can be detected in transactions.
 */
export enum AnomalyType {
  HighAmount = "high_amount",
  LowAmount = "low_amount",
  Duplicate = "duplicate",
  UnusualFrequency = "unusual_frequency",
}
