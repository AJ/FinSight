/**
 * Interest Calculator - Credit Card Interest Projections
 *
 * Calculates payoff scenarios including:
 * - Minimum payment payoff timeline
 * - Fixed payment scenarios
 * - Interest cost projections
 */

import { CreditCardStatement, InterestProjection } from '@/types/creditCard';
import {
  DEFAULT_MIN_PAYMENT_PERCENT,
  DEFAULT_MIN_PAYMENT_FLOOR,
  MONTHS_IN_YEAR,
} from './constants';

/** Maximum months to simulate (prevents infinite loops) */
const MAX_MONTHS = 600; // 50 years

/**
 * Calculate payoff timeline with declining minimum payments
 * Each month the minimum payment decreases as the balance decreases
 */
export function calculateMinimumPayoff(
  balance: number,
  apr: number,
  minPercent: number = DEFAULT_MIN_PAYMENT_PERCENT,
  minFloor: number = DEFAULT_MIN_PAYMENT_FLOOR
): { months: number; totalInterest: number; totalPaid: number } {
  let currentBalance = balance;
  let totalInterest = 0;
  let totalPaid = 0;
  let months = 0;

  const monthlyRate = apr / MONTHS_IN_YEAR;

  while (currentBalance > 0 && months < MAX_MONTHS) {
    // Calculate interest for this month
    const monthlyInterest = currentBalance * monthlyRate;
    totalInterest += monthlyInterest;
    currentBalance += monthlyInterest;

    // Calculate minimum payment
    const percentBased = currentBalance * minPercent;
    const minPayment = Math.max(percentBased, minFloor);

    // Apply payment
    const payment = Math.min(minPayment, currentBalance);
    currentBalance -= payment;
    totalPaid += payment;
    months++;

    // Safety check for very small balances
    if (currentBalance < 1) {
      totalPaid += currentBalance;
      currentBalance = 0;
    }
  }

  return { months, totalInterest, totalPaid };
}

/**
 * Calculate payoff timeline with fixed monthly payment
 */
export function calculateFixedPayoff(
  balance: number,
  apr: number,
  monthlyPayment: number
): { months: number; totalInterest: number; totalPaid: number } {
  let currentBalance = balance;
  let totalInterest = 0;
  let totalPaid = 0;
  let months = 0;

  const monthlyRate = apr / MONTHS_IN_YEAR;

  // Check if payment is enough to cover interest
  if (monthlyPayment <= balance * monthlyRate) {
    return { months: -1, totalInterest: Infinity, totalPaid: Infinity };
  }

  while (currentBalance > 0 && months < MAX_MONTHS) {
    // Calculate interest for this month
    const monthlyInterest = currentBalance * monthlyRate;
    totalInterest += monthlyInterest;
    currentBalance += monthlyInterest;

    // Apply fixed payment
    const payment = Math.min(monthlyPayment, currentBalance);
    currentBalance -= payment;
    totalPaid += payment;
    months++;

    // Safety check for very small balances
    if (currentBalance < 1) {
      totalPaid += currentBalance;
      currentBalance = 0;
    }
  }

  return { months, totalInterest, totalPaid };
}

/**
 * Generate a complete interest projection for a statement
 */
export function generateProjection(
  statement: CreditCardStatement,
  apr: number
): InterestProjection {
  const balance = statement.totalDue;
  const minPercent = statement.minimumPaymentPercent ?? DEFAULT_MIN_PAYMENT_PERCENT;
  const minFloor = statement.minimumPaymentFloor ?? DEFAULT_MIN_PAYMENT_FLOOR;

  // Calculate minimum payment payoff
  const minimumPayoff = calculateMinimumPayoff(balance, apr, minPercent, minFloor);

  // Generate fixed payment scenarios (10%, 25%, 50% more than minimum)
  const baseMinPayment = Math.max(balance * minPercent, minFloor);
  const fixedPaymentScenarios = [
    { label: '10% more', multiplier: 1.1 },
    { label: '25% more', multiplier: 1.25 },
    { label: '50% more', multiplier: 1.5 },
    { label: 'Double', multiplier: 2 },
  ].map(({ label, multiplier }) => {
    const payment = Math.ceil(baseMinPayment * multiplier);
    const result = calculateFixedPayoff(balance, apr, payment);
    return {
      label,
      monthlyPayment: payment,
      monthsToPayoff: result.months,
      totalInterest: result.totalInterest,
      totalPaid: result.totalPaid,
    };
  }).filter((s) => s.monthsToPayoff > 0);

  // Calculate savings from paying in full now vs minimum payments
  const fullPaySavings = minimumPayoff.totalInterest;

  return {
    cardIssuer: statement.cardIssuer,
    cardLastFour: statement.cardLastFour,
    currentBalance: balance,
    apr,
    minimumDue: statement.minimumDue,
    minimumPayoff: {
      monthsToPayoff: minimumPayoff.months,
      totalInterest: minimumPayoff.totalInterest,
      totalPaid: minimumPayoff.totalPaid,
    },
    fixedPaymentScenarios,
    fullPaySavings,
  };
}

/**
 * Format months to a human-readable string
 */
export function formatPayoffTime(months: number): string {
  if (months < 0) return 'Never (payment too low)';
  if (months === 0) return 'Paid off';
  if (months >= MAX_MONTHS) return '50+ years';

  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;

  if (years === 0) {
    return `${remainingMonths} month${remainingMonths !== 1 ? 's' : ''}`;
  } else if (remainingMonths === 0) {
    return `${years} year${years !== 1 ? 's' : ''}`;
  } else {
    return `${years} year${years !== 1 ? 's' : ''} ${remainingMonths} month${remainingMonths !== 1 ? 's' : ''}`;
  }
}
