/**
 * Payment Strategy - Avalanche vs Snowball Methods
 *
 * Avalanche: Pay highest APR first (mathematically optimal)
 * Snowball: Pay lowest balance first (psychologically motivating)
 */

import { PaymentRecommendation, CardPaymentRecommendation } from '@/types/creditCard';

interface CardForStrategy {
  issuer: string;
  lastFour: string;
  balance: number;
  apr: number;
}

/**
 * Avalanche strategy: Prioritize highest APR cards
 * Mathematically optimal - minimizes total interest paid
 */
export function calculateAvalanche(
  cards: CardForStrategy[],
  availableAmount: number
): PaymentRecommendation {
  // Sort by APR descending (highest first)
  const sorted = [...cards].sort((a, b) => b.apr - a.apr);
  return calculatePaymentPlan(sorted, availableAmount, 'avalanche');
}

/**
 * Snowball strategy: Prioritize lowest balance cards
 * Psychological wins - faster sense of progress
 */
export function calculateSnowball(
  cards: CardForStrategy[],
  availableAmount: number
): PaymentRecommendation {
  // Sort by balance ascending (lowest first)
  const sorted = [...cards].sort((a, b) => a.balance - b.balance);
  return calculatePaymentPlan(sorted, availableAmount, 'snowball');
}

/**
 * Calculate the payment plan based on sorted priority
 */
function calculatePaymentPlan(
  sortedCards: CardForStrategy[],
  availableAmount: number,
  strategy: 'avalanche' | 'snowball'
): PaymentRecommendation {
  const totalDebt = sortedCards.reduce((sum, c) => sum + c.balance, 0);
  const cardPayments: CardPaymentRecommendation[] = [];
  const now = new Date();

  // Track how much money is available
  let remaining = availableAmount;

  // First pass: calculate and reserve minimum payments for all cards
  const payments: { card: CardForStrategy; minPay: number; extraPay: number }[] = [];

  for (const card of sortedCards) {
    const minPay = Math.min(Math.max(card.balance * 0.05, 200), card.balance);
    if (remaining >= minPay) {
      remaining -= minPay;
      payments.push({ card, minPay, extraPay: 0 });
    } else {
      payments.push({ card, minPay: Math.min(minPay, remaining), extraPay: 0 });
      remaining = 0;
    }
  }

  // Second pass: allocate extra money to priority cards (first in sorted order)
  for (const payment of payments) {
    if (remaining <= 0) break;

    const balanceAfterMin = payment.card.balance - payment.minPay;
    const extraPay = Math.min(remaining, balanceAfterMin);
    payment.extraPay = extraPay;
    remaining -= extraPay;
  }

  // Build payment recommendations
  let priority = 1;
  for (const payment of payments) {
    const recommendedPayment = payment.minPay + payment.extraPay;

    let reason: string;
    if (strategy === 'avalanche') {
      if (priority === 1) {
        reason = `Highest interest rate (${(payment.card.apr * 100).toFixed(1)}% APR)`;
      } else {
        reason = `${(payment.card.apr * 100).toFixed(1)}% APR`;
      }
    } else {
      if (priority === 1) {
        reason = `Lowest balance - quick win`;
      } else {
        reason = `Balance: ${payment.card.balance.toLocaleString()}`;
      }
    }

    cardPayments.push({
      cardIssuer: payment.card.issuer,
      cardLastFour: payment.card.lastFour,
      balance: payment.card.balance,
      apr: payment.card.apr,
      recommendedPayment: Math.round(recommendedPayment * 100) / 100,
      priority,
      reason,
    });

    priority++;
  }

  // Calculate projected savings (compared to minimum-only payments)
  const projectedSavings = calculateSavings(sortedCards);

  // Estimate debt-free date
  const debtFreeDate = estimateDebtFreeDate(sortedCards, availableAmount, now);

  return {
    strategy,
    totalDebt,
    availableForPayment: availableAmount,
    cardPayments,
    projectedSavings,
    debtFreeDate,
  };
}

/**
 * Calculate interest savings from extra payments
 */
function calculateSavings(
  cards: CardForStrategy[]
): number {
  // Simplified savings calculation
  // Compare interest paid with minimum-only vs with extra payments
  let savings = 0;

  for (const card of cards) {
    const monthlyRate = card.apr / 12;
    const minPayment = Math.max(card.balance * 0.05, 200);

    // Interest if paying minimum only (approximate)
    const minOnlyInterest = card.balance * monthlyRate * (card.balance / minPayment);

    // Interest with higher payments (approximate)
    const effectivePayment = Math.min(minPayment * 1.5, card.balance);
    const acceleratedInterest = card.balance * monthlyRate * (card.balance / effectivePayment);

    savings += Math.max(0, minOnlyInterest - acceleratedInterest);
  }

  return Math.round(savings);
}

/**
 * Estimate when debt will be fully paid off
 */
function estimateDebtFreeDate(
  cards: CardForStrategy[],
  monthlyPayment: number,
  startDate: Date
): Date {
  const totalDebt = cards.reduce((sum, c) => sum + c.balance, 0);
  const avgAPR = cards.reduce((sum, c) => sum + c.apr, 0) / cards.length || 0.408;

  // Simple estimation: how many months to pay off at this rate
  const monthlyRate = avgAPR / 12;
  let balance = totalDebt;
  let months = 0;

  while (balance > 0 && months < 120) { // Max 10 years
    balance += balance * monthlyRate;
    balance -= monthlyPayment;
    months++;
  }

  const debtFreeDate = new Date(startDate);
  debtFreeDate.setMonth(debtFreeDate.getMonth() + months);
  return debtFreeDate;
}

/**
 * Compare both strategies and return which is better
 */
export function compareStrategies(
  cards: CardForStrategy[],
  availableAmount: number
): {
  avalanche: PaymentRecommendation;
  snowball: PaymentRecommendation;
  recommended: 'avalanche' | 'snowball';
  savingsDifference: number;
} {
  const avalanche = calculateAvalanche(cards, availableAmount);
  const snowball = calculateSnowball(cards, availableAmount);

  const savingsDifference = avalanche.projectedSavings - snowball.projectedSavings;
  const recommended = savingsDifference > 0 ? 'avalanche' : 'snowball';

  return {
    avalanche,
    snowball,
    recommended,
    savingsDifference: Math.abs(savingsDifference),
  };
}
