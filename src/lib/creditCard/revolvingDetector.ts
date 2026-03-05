/**
 * Revolving Balance Detector - Debt Trap Analysis
 *
 * Analyzes statement history to detect concerning patterns:
 * - Carrying balance month-to-month
 * - Paying only minimum
 * - Increasing balance trend
 */

import {
  CreditCardStatement,
  RevolvingBalanceStatus,
  DebtTrapAnalysis,
} from '@/types/creditCard';
import { RISK_THRESHOLDS } from './constants';

/** Ensure a value is a proper Date object */
function toDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v);
}

/**
 * Analyze revolving balance patterns for a single card
 */
export function analyzeRevolvingBalance(
  statements: CreditCardStatement[]
): RevolvingBalanceStatus {
  if (statements.length === 0) {
    return {
      cardIssuer: 'Unknown',
      cardLastFour: 'Unknown',
      isRevolving: false,
      paysMinimumOnly: false,
      balanceIncreasing: false,
      averageBalance: 0,
      balanceTrend: 0,
      consecutiveMonthsRevolving: 0,
      riskLevel: 'none',
      warnings: [],
    };
  }

  // Sort by statement date
  const sorted = [...statements].sort(
    (a, b) => toDate(a.statementDate).getTime() - toDate(b.statementDate).getTime()
  );

  const cardIssuer = sorted[0].cardIssuer;
  const cardLastFour = sorted[0].cardLastFour;
  const warnings: string[] = [];

  // Calculate average balance
  const averageBalance = sorted.reduce((sum, s) => sum + s.totalDue, 0) / sorted.length;

  // Detect revolving pattern (payments < total due)
  let revolvingCount = 0;
  let consecutiveRevolving = 0;
  let maxConsecutive = 0;

  for (const stmt of sorted) {
    const isRevolvingThisMonth = stmt.paymentsReceived < stmt.totalDue * 0.95;
    if (isRevolvingThisMonth) {
      revolvingCount++;
      consecutiveRevolving++;
      maxConsecutive = Math.max(maxConsecutive, consecutiveRevolving);
    } else {
      consecutiveRevolving = 0;
    }
  }

  const isRevolving = revolvingCount > sorted.length * 0.5;

  if (maxConsecutive >= 3) {
    warnings.push(`Carried balance for ${maxConsecutive} consecutive months`);
  }

  // Detect minimum-only payments
  let minimumOnlyCount = 0;
  for (const stmt of sorted) {
    const minPayment = stmt.minimumDue * 1.05; // 5% tolerance
    if (stmt.paymentsReceived > 0 && stmt.paymentsReceived <= minPayment) {
      minimumOnlyCount++;
    }
  }

  const paysMinimumOnly = minimumOnlyCount > sorted.length * 0.5;

  if (minimumOnlyCount >= 3) {
    warnings.push(`Paid only minimum ${minimumOnlyCount} times`);
  }

  // Calculate balance trend using linear regression
  const balanceTrend = calculateBalanceTrend(sorted);
  const balanceIncreasing = balanceTrend > 0.05;

  if (balanceIncreasing) {
    warnings.push(`Balance trending upward (${(balanceTrend * 100).toFixed(1)}% monthly)`);
  }

  // Check for interest charges
  const interestChargedCount = sorted.filter((s) => (s.interestCharged ?? 0) > 0).length;
  if (interestChargedCount > 0) {
    warnings.push(`Interest charged in ${interestChargedCount} statements`);
  }

  // Calculate full pay rate
  const fullPayCount = sorted.filter((s) => s.paymentsReceived >= s.totalDue * 0.95).length;
  const fullPayRate = fullPayCount / sorted.length;

  // Determine risk level
  const riskLevel = determineRiskLevel(
    fullPayRate,
    maxConsecutive,
    balanceIncreasing
  );

  return {
    cardIssuer,
    cardLastFour,
    isRevolving,
    paysMinimumOnly,
    balanceIncreasing,
    averageBalance,
    balanceTrend,
    consecutiveMonthsRevolving: maxConsecutive,
    riskLevel,
    warnings,
  };
}

/**
 * Calculate balance trend using simple linear regression
 * Returns monthly change rate (positive = increasing)
 */
function calculateBalanceTrend(statements: CreditCardStatement[]): number {
  if (statements.length < 2) return 0;

  const n = statements.length;
  const sorted = [...statements].sort(
    (a, b) => toDate(a.statementDate).getTime() - toDate(b.statementDate).getTime()
  );

  // Convert dates to months from start
  const startDate = toDate(sorted[0].statementDate);
  const points: { x: number; y: number }[] = sorted.map((s) => ({
    x: (toDate(s.statementDate).getTime() - startDate.getTime()) / (30 * 24 * 60 * 60 * 1000),
    y: s.totalDue,
  }));

  // Simple linear regression
  const sumX = points.reduce((sum, p) => sum + p.x, 0);
  const sumY = points.reduce((sum, p) => sum + p.y, 0);
  const sumXY = points.reduce((sum, p) => sum + p.x * p.y, 0);
  const sumX2 = points.reduce((sum, p) => sum + p.x * p.x, 0);

  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return 0;

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const avgY = sumY / n;

  // Return as percentage change per month
  return avgY > 0 ? slope / avgY : 0;
}

/**
 * Determine risk level based on multiple factors
 */
function determineRiskLevel(
  fullPayRate: number,
  consecutiveMonths: number,
  balanceIncreasing: boolean
): RevolvingBalanceStatus['riskLevel'] {
  // High risk conditions
  if (
    fullPayRate < RISK_THRESHOLDS.fullPayRate.medium ||
    consecutiveMonths >= RISK_THRESHOLDS.consecutiveMonthsRevolving.high ||
    (balanceIncreasing && consecutiveMonths >= RISK_THRESHOLDS.consecutiveMonthsRevolving.medium)
  ) {
    return 'high';
  }

  // Medium risk conditions
  if (
    fullPayRate < RISK_THRESHOLDS.fullPayRate.low ||
    consecutiveMonths >= RISK_THRESHOLDS.consecutiveMonthsRevolving.medium ||
    balanceIncreasing
  ) {
    return 'medium';
  }

  // Low risk conditions
  if (
    fullPayRate < RISK_THRESHOLDS.fullPayRate.none ||
    consecutiveMonths >= RISK_THRESHOLDS.consecutiveMonthsRevolving.low
  ) {
    return 'low';
  }

  return 'none';
}

/**
 * Calculate overall debt trap analysis for all cards
 */
export function calculateDebtTrapAnalysis(
  allStatements: CreditCardStatement[]
): DebtTrapAnalysis {
  if (allStatements.length === 0) {
    return {
      cards: [],
      totalRevolvingDebt: 0,
      overallRiskLevel: 'none',
      recommendations: [],
    };
  }

  // Group statements by card
  const cardGroups = new Map<string, CreditCardStatement[]>();
  for (const stmt of allStatements) {
    const key = `${stmt.cardIssuer}-${stmt.cardLastFour}`;
    if (!cardGroups.has(key)) {
      cardGroups.set(key, []);
    }
    cardGroups.get(key)!.push(stmt);
  }

  // Analyze each card
  const cards = Array.from(cardGroups.values()).map((statements) =>
    analyzeRevolvingBalance(statements)
  );

  // Calculate total revolving debt (cards with risk > none)
  const totalRevolvingDebt = cards
    .filter((c) => c.riskLevel !== 'none')
    .reduce((sum, c) => sum + c.averageBalance, 0);

  // Determine overall risk level
  const riskLevels: RevolvingBalanceStatus['riskLevel'][] = ['none', 'low', 'medium', 'high'];
  const highestRisk = cards.reduce(
    (max, c) => (riskLevels.indexOf(c.riskLevel) > riskLevels.indexOf(max) ? c.riskLevel : max),
    'none' as RevolvingBalanceStatus['riskLevel']
  );

  // Determine if critical (multiple high-risk cards)
  const highRiskCount = cards.filter((c) => c.riskLevel === 'high').length;
  const overallRiskLevel = highRiskCount >= 2 ? 'critical' : highestRisk;

  // Generate recommendations
  const recommendations = generateRecommendations(cards, overallRiskLevel);

  return {
    cards,
    totalRevolvingDebt,
    overallRiskLevel,
    recommendations,
  };
}

/**
 * Generate actionable recommendations based on analysis
 */
function generateRecommendations(
  cards: RevolvingBalanceStatus[],
  overallRisk: DebtTrapAnalysis['overallRiskLevel']
): string[] {
  const recommendations: string[] = [];

  if (overallRisk === 'none') {
    recommendations.push('Great job! You\'re paying your cards in full each month.');
    return recommendations;
  }

  // High/Critical risk recommendations
  if (overallRisk === 'high' || overallRisk === 'critical') {
    recommendations.push('Consider speaking with a financial counselor about debt management options.');
    recommendations.push('Stop using credit cards for new purchases until balances are under control.');
  }

  // Cards paying minimum only
  const minOnlyCards = cards.filter((c) => c.paysMinimumOnly);
  if (minOnlyCards.length > 0) {
    recommendations.push(
      `Pay more than minimum on ${minOnlyCards[0].cardIssuer} ****${minOnlyCards[0].cardLastFour} to reduce interest costs.`
    );
  }

  // Cards with increasing balance
  const increasingCards = cards.filter((c) => c.balanceIncreasing);
  if (increasingCards.length > 0) {
    recommendations.push(
      `Your ${increasingCards[0].cardIssuer} balance is trending upward. Review spending patterns.`
    );
  }

  // Avalanche/Snowball suggestion
  const revolvingCards = cards.filter((c) => c.isRevolving);
  if (revolvingCards.length > 1) {
    recommendations.push(
      'Consider the "avalanche" method: pay minimum on all cards, put extra toward highest APR card.'
    );
  }

  // General advice for medium risk
  if (overallRisk === 'medium') {
    recommendations.push('Set up automatic payments for the full statement balance to avoid interest.');
  }

  return recommendations;
}
