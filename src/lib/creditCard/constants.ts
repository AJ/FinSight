/**
 * Credit Card Bill Analyzer - Constants
 *
 * Default values for APR, point valuations, and payment calculations.
 * Used when extraction from statements fails.
 */

// Default APR by issuer (as decimal, e.g., 0.408 = 40.8%)
export const DEFAULT_APR_BY_ISSUER: Record<string, number> = {
  'HDFC Bank': 0.408,
  'ICICI Bank': 0.42,
  'Axis Bank': 0.396,
  'SBI Card': 0.432,
  'Kotak': 0.42,
  'American Express': 0.36,
  'Citibank': 0.378,
  'Standard Chartered': 0.396,
  'HSBC': 0.408,
  'RBL Bank': 0.42,
  'Yes Bank': 0.42,
  'IndusInd': 0.396,
  'default': 0.408,
};

// Default minimum payment parameters
export const DEFAULT_MIN_PAYMENT_PERCENT = 0.05; // 5% of outstanding
export const DEFAULT_MIN_PAYMENT_FLOOR = 200; // Minimum Rs 200

// Approximate point values (Rs per point)
export const POINT_VALUE_BY_ISSUER: Record<string, number> = {
  'HDFC Bank': 0.20,       // ~20p per point
  'ICICI Bank': 0.25,      // ~25p per point
  'Axis Bank': 0.20,       // ~20p per point
  'SBI Card': 0.25,        // ~25p per point
  'American Express': 0.50, // Higher value
  'Citibank': 0.30,
  'Standard Chartered': 0.25,
  'HSBC': 0.25,
  'RBL Bank': 0.20,
  'Yes Bank': 0.20,
  'default': 0.20,
};

// Interest calculation constants
export const MONTHS_IN_YEAR = 12;

// Risk thresholds for debt detection
export const RISK_THRESHOLDS = {
  fullPayRate: {
    none: 0.90,
    low: 0.70,
    medium: 0.50,
    high: 0,
  },
  consecutiveMonthsRevolving: {
    low: 3,
    medium: 6,
    high: 12,
  },
  utilization: {
    low: 0.30,
    medium: 0.50,
    high: 0.70,
  },
} as const;

/**
 * Get APR for an issuer with fallback
 */
export function getAPRForIssuer(issuer: string, extractedAPR?: number): number {
  if (extractedAPR && extractedAPR > 0) {
    return extractedAPR;
  }

  // Try exact match first
  if (DEFAULT_APR_BY_ISSUER[issuer]) {
    return DEFAULT_APR_BY_ISSUER[issuer];
  }

  // Try partial match
  const partialMatch = Object.keys(DEFAULT_APR_BY_ISSUER).find((key) =>
    issuer.toLowerCase().includes(key.toLowerCase()) ||
    key.toLowerCase().includes(issuer.toLowerCase())
  );

  if (partialMatch && partialMatch !== 'default') {
    return DEFAULT_APR_BY_ISSUER[partialMatch];
  }

  return DEFAULT_APR_BY_ISSUER.default;
}

/**
 * Get point value for an issuer with fallback
 */
export function getPointValueForIssuer(issuer: string): number {
  if (POINT_VALUE_BY_ISSUER[issuer]) {
    return POINT_VALUE_BY_ISSUER[issuer];
  }

  const partialMatch = Object.keys(POINT_VALUE_BY_ISSUER).find((key) =>
    issuer.toLowerCase().includes(key.toLowerCase()) ||
    key.toLowerCase().includes(issuer.toLowerCase())
  );

  if (partialMatch && partialMatch !== 'default') {
    return POINT_VALUE_BY_ISSUER[partialMatch];
  }

  return POINT_VALUE_BY_ISSUER.default;
}
