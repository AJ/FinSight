import { describe, it, expect } from 'vitest';
import { calculateMinimumPayoff, calculateFixedPayoff, generateProjection, formatPayoffTime } from '@/lib/creditCard/interestCalculator';
import type { CreditCardStatement } from '@/types/creditCard';

describe('calculateMinimumPayoff', () => {
  it('calculates months to payoff for small balance', () => {
    const result = calculateMinimumPayoff(50000, 0.408, 0.05, 500);
    expect(result.months).toBeGreaterThan(30);   // Must take meaningful time
    expect(result.months).toBeLessThan(200);      // But not infinite
    expect(result.totalInterest).toBeGreaterThan(1000); // Must incur real interest
    expect(result.totalPaid).toBeGreaterThan(50000);    // Paid more than principal
  });

  it('returns finite months for reasonable payment', () => {
    const result = calculateMinimumPayoff(10000, 0.36, 0.10, 100);
    expect(result.months).toBeGreaterThan(10);
    expect(result.months).toBeLessThan(100);
    expect(result.totalPaid).toBeCloseTo(10000 + result.totalInterest, -1);
  });
});

describe('calculateFixedPayoff', () => {
  it('calculates payoff with sufficient payment', () => {
    const result = calculateFixedPayoff(50000, 0.408, 5000);
    expect(result.months).toBeGreaterThan(10);   // Reasonable payoff time
    expect(result.months).toBeLessThan(30);       // But not too long
    expect(result.totalInterest).toBeGreaterThan(0);
    expect(result.totalPaid).toBeCloseTo(50000 + result.totalInterest, -1);
  });

  it('returns -1 months for insufficient payment', () => {
    const result = calculateFixedPayoff(50000, 0.408, 100); // Too low to cover interest
    expect(result.months).toBe(-1);
    expect(result.totalInterest).toBe(Infinity);
    expect(result.totalPaid).toBe(Infinity);
  });
});

describe('generateProjection', () => {
  it('returns all scenarios', () => {
    const statement: CreditCardStatement = {
      cardIssuer: 'HDFC',
      cardLastFour: '1234',
      totalDue: 25000,
      minimumDue: 2500,
      minimumPaymentPercent: 0.05,
      minimumPaymentFloor: 500,
    } as CreditCardStatement;
    const result = generateProjection(statement, 0.408);
    expect(result.cardIssuer).toBe('HDFC');
    expect(result.currentBalance).toBe(25000);
    expect(result.minimumPayoff.monthsToPayoff).toBeGreaterThan(0);
    expect(result.fixedPaymentScenarios.length).toBeGreaterThan(0);
  });
});

describe('formatPayoffTime', () => {
  it('formats months under 12', () => {
    expect(formatPayoffTime(6)).toBe('6 months');
  });

  it('formats single month', () => {
    expect(formatPayoffTime(1)).toBe('1 month');
  });

  it('formats years only', () => {
    expect(formatPayoffTime(24)).toBe('2 years');
  });

  it('formats years and months', () => {
    expect(formatPayoffTime(13)).toBe('1 year 1 month');
  });

  it('handles negative months', () => {
    expect(formatPayoffTime(-1)).toBe('Never (payment too low)');
  });

  it('handles zero months', () => {
    expect(formatPayoffTime(0)).toBe('Paid off');
  });

  it('handles 600+ months (MAX_MONTHS threshold)', () => {
    expect(formatPayoffTime(600)).toBe('50+ years');
  });

  it('formats single year', () => {
    expect(formatPayoffTime(12)).toBe('1 year');
  });

  it('formats years and months with plural both', () => {
    expect(formatPayoffTime(27)).toBe('2 years 3 months');
  });
});
