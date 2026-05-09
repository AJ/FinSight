import { describe, it, expect, beforeEach } from 'vitest';

import { useCreditCardStore } from '@/lib/store/creditCardStore';
import type { CreditCardStatement } from '@/types/creditCard';

beforeEach(() => {
  useCreditCardStore.setState({ statements: [], isParsing: false });
});

function makeStatement(overrides: Partial<CreditCardStatement> = {}): CreditCardStatement {
  return {
    id: 'stmt-1',
    fileName: 'statement.pdf',
    parseDate: new Date('2024-06-01'),
    cardLastFour: '1234',
    cardIssuer: 'HDFC',
    statementPeriod: { start: new Date('2024-05-01'), end: new Date('2024-05-31') },
    statementDate: new Date('2024-06-01'),
    paymentDueDate: new Date('2024-06-20'),
    totalDue: 50000,
    minimumDue: 2500,
    creditLimit: 200000,
    availableCredit: 150000,
    previousBalance: 45000,
    paymentsReceived: 45000,
    purchasesAndCharges: 50000,
    interestCharged: 0,
    lateFee: 0,
    isPaid: false,
    ...overrides,
  };
}

describe('creditCardStore', () => {
  describe('addStatement', () => {
    it('appends a statement', () => {
      useCreditCardStore.getState().addStatement(makeStatement());
      expect(useCreditCardStore.getState().statements).toHaveLength(1);
    });

    it('preserves existing statements', () => {
      useCreditCardStore.getState().addStatement(makeStatement({ id: 's1' }));
      useCreditCardStore.getState().addStatement(makeStatement({ id: 's2' }));
      expect(useCreditCardStore.getState().statements).toHaveLength(2);
    });
  });

  describe('addStatements', () => {
    it('adds multiple statements at once', () => {
      useCreditCardStore.getState().addStatements([
        makeStatement({ id: 's1' }),
        makeStatement({ id: 's2' }),
      ]);
      expect(useCreditCardStore.getState().statements).toHaveLength(2);
    });
  });

  describe('clearStatements', () => {
    it('removes all statements', () => {
      useCreditCardStore.getState().addStatement(makeStatement());
      useCreditCardStore.getState().clearStatements();
      expect(useCreditCardStore.getState().statements).toHaveLength(0);
    });
  });

  describe('markStatementPaid', () => {
    it('marks matching statement as paid', () => {
      useCreditCardStore.getState().addStatement(makeStatement({ id: 's1' }));
      const paidDate = new Date('2024-06-15');
      useCreditCardStore.getState().markStatementPaid('s1', paidDate, 50000);

      const stmt = useCreditCardStore.getState().statements[0];
      expect(stmt.isPaid).toBe(true);
      expect(stmt.paidDate).toEqual(paidDate);
      expect(stmt.paidAmount).toBe(50000);
    });

    it('defaults paidAmount to totalDue when not provided', () => {
      useCreditCardStore.getState().addStatement(makeStatement({ id: 's1', totalDue: 30000 }));
      useCreditCardStore.getState().markStatementPaid('s1', new Date());

      expect(useCreditCardStore.getState().statements[0].paidAmount).toBe(30000);
    });

    it('does not affect other statements', () => {
      useCreditCardStore.getState().addStatements([
        makeStatement({ id: 's1' }),
        makeStatement({ id: 's2' }),
      ]);
      useCreditCardStore.getState().markStatementPaid('s1', new Date());

      expect(useCreditCardStore.getState().statements[1].isPaid).toBe(false);
    });
  });

  describe('updateStatement', () => {
    it('updates matching statement', () => {
      useCreditCardStore.getState().addStatement(makeStatement({ id: 's1' }));
      useCreditCardStore.getState().updateStatement('s1', { totalDue: 60000 });

      expect(useCreditCardStore.getState().statements[0].totalDue).toBe(60000);
    });

    it('preserves other fields', () => {
      useCreditCardStore.getState().addStatement(makeStatement({ id: 's1' }));
      useCreditCardStore.getState().updateStatement('s1', { totalDue: 60000 });

      const stmt = useCreditCardStore.getState().statements[0];
      expect(stmt.cardIssuer).toBe('HDFC');
      expect(stmt.minimumDue).toBe(2500);
    });
  });

  describe('getStatementsByCard', () => {
    it('filters by cardIssuer and cardLastFour', () => {
      useCreditCardStore.getState().addStatements([
        makeStatement({ id: 's1', cardIssuer: 'HDFC', cardLastFour: '1234' }),
        makeStatement({ id: 's2', cardIssuer: 'SBI', cardLastFour: '5678' }),
      ]);

      const result = useCreditCardStore.getState().getStatementsByCard('HDFC', '1234');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('s1');
    });

    it('returns empty for no match', () => {
      useCreditCardStore.getState().addStatement(makeStatement());
      expect(useCreditCardStore.getState().getStatementsByCard('ICICI', '0000')).toHaveLength(0);
    });
  });

  describe('getStatementsByIssuer', () => {
    it('filters by issuer', () => {
      useCreditCardStore.getState().addStatements([
        makeStatement({ id: 's1', cardIssuer: 'HDFC' }),
        makeStatement({ id: 's2', cardIssuer: 'HDFC' }),
        makeStatement({ id: 's3', cardIssuer: 'SBI' }),
      ]);

      expect(useCreditCardStore.getState().getStatementsByIssuer('HDFC')).toHaveLength(2);
    });
  });

  describe('getMostRecentStatement', () => {
    it('returns statement with latest date for a card', () => {
      useCreditCardStore.getState().addStatements([
        makeStatement({ id: 's1', statementDate: new Date('2024-01-01') }),
        makeStatement({ id: 's2', statementDate: new Date('2024-06-01') }),
      ]);

      const result = useCreditCardStore.getState().getMostRecentStatement('HDFC', '1234');
      expect(result!.id).toBe('s2');
    });

    it('returns undefined for no matching card', () => {
      expect(useCreditCardStore.getState().getMostRecentStatement('NONE', '0000')).toBeUndefined();
    });
  });

  describe('getAllUniqueCards', () => {
    it('returns deduplicated cards', () => {
      useCreditCardStore.getState().addStatements([
        makeStatement({ cardIssuer: 'HDFC', cardLastFour: '1234' }),
        makeStatement({ cardIssuer: 'HDFC', cardLastFour: '1234' }),
        makeStatement({ cardIssuer: 'SBI', cardLastFour: '5678' }),
      ]);

      const cards = useCreditCardStore.getState().getAllUniqueCards();
      expect(cards).toHaveLength(2);
    });

    it('preserves cardHolder from first occurrence', () => {
      useCreditCardStore.getState().addStatements([
        makeStatement({ cardIssuer: 'HDFC', cardLastFour: '1234', cardHolder: 'John' }),
        makeStatement({ cardIssuer: 'HDFC', cardLastFour: '1234' }),
      ]);

      const cards = useCreditCardStore.getState().getAllUniqueCards();
      expect(cards[0].cardHolder).toBe('John');
    });
  });

  describe('getTotalOutstanding', () => {
    it('sums totalDue from most recent statement of each card', () => {
      useCreditCardStore.getState().addStatements([
        makeStatement({ cardIssuer: 'HDFC', cardLastFour: '1234', totalDue: 50000, statementDate: new Date('2024-06-01') }),
        makeStatement({ cardIssuer: 'HDFC', cardLastFour: '1234', totalDue: 30000, statementDate: new Date('2024-01-01') }),
        makeStatement({ cardIssuer: 'SBI', cardLastFour: '5678', totalDue: 20000, statementDate: new Date('2024-06-01') }),
      ]);

      expect(useCreditCardStore.getState().getTotalOutstanding()).toBe(70000);
    });

    it('returns 0 with no statements', () => {
      expect(useCreditCardStore.getState().getTotalOutstanding()).toBe(0);
    });
  });

  describe('getTotalCreditLimit', () => {
    it('sums creditLimit from most recent statement of each card', () => {
      useCreditCardStore.getState().addStatements([
        makeStatement({ cardIssuer: 'HDFC', cardLastFour: '1234', creditLimit: 200000, statementDate: new Date('2024-06-01') }),
        makeStatement({ cardIssuer: 'SBI', cardLastFour: '5678', creditLimit: 100000, statementDate: new Date('2024-06-01') }),
      ]);

      expect(useCreditCardStore.getState().getTotalCreditLimit()).toBe(300000);
    });
  });

  describe('getUtilization', () => {
    it('calculates per-card and aggregate utilization', () => {
      useCreditCardStore.getState().addStatement(
        makeStatement({ cardIssuer: 'HDFC', cardLastFour: '1234', totalDue: 50000, creditLimit: 200000 }),
      );

      const result = useCreditCardStore.getState().getUtilization();
      expect(result.aggregate).toBeCloseTo(0.25);
      expect(result.totalDue).toBe(50000);
      expect(result.totalLimit).toBe(200000);

      const perCard = result.perCard.get('HDFC-1234');
      expect(perCard).toBeDefined();
      expect(perCard!.utilization).toBeCloseTo(0.25);
    });

    it('handles zero creditLimit gracefully', () => {
      useCreditCardStore.getState().addStatement(
        makeStatement({ totalDue: 50000, creditLimit: 0 }),
      );

      const result = useCreditCardStore.getState().getUtilization();
      expect(result.aggregate).toBe(0);
      const perCard = result.perCard.get('HDFC-1234');
      expect(perCard!.utilization).toBe(0);
    });

    it('returns zeroed result with no statements', () => {
      const result = useCreditCardStore.getState().getUtilization();
      expect(result.aggregate).toBe(0);
      expect(result.totalDue).toBe(0);
    });
  });

  describe('getDueDates', () => {
    it('returns due dates for unpaid statements', () => {
      useCreditCardStore.getState().addStatement(
        makeStatement({ paymentDueDate: new Date('2029-06-20'), isPaid: false }),
      );

      const result = useCreditCardStore.getState().getDueDates();
      expect(result).toHaveLength(1);
      expect(result[0].daysUntilDue).toBeGreaterThan(0);
      expect(result[0].isOverdue).toBe(false);
    });

    it('skips paid statements', () => {
      useCreditCardStore.getState().addStatement(
        makeStatement({ isPaid: true, paidDate: new Date() }),
      );

      expect(useCreditCardStore.getState().getDueDates()).toHaveLength(0);
    });

    it('marks overdue when due date is in the past', () => {
      useCreditCardStore.getState().addStatement(
        makeStatement({ paymentDueDate: new Date('2020-01-01'), isPaid: false }),
      );

      const result = useCreditCardStore.getState().getDueDates();
      expect(result[0].isOverdue).toBe(true);
      expect(result[0].daysUntilDue).toBeLessThan(0);
    });
  });

  describe('getPaymentBehavior', () => {
    it('returns zeroed result for no statements', () => {
      const result = useCreditCardStore.getState().getPaymentBehavior(6);
      expect(result.statementCount).toBe(0);
      expect(result.fullPayRate).toBe(0);
    });

    it('calculates full pay rate correctly', () => {
      useCreditCardStore.getState().addStatements([
        makeStatement({ id: 's1', totalDue: 50000, paymentsReceived: 50000, statementDate: new Date() }),
        makeStatement({ id: 's2', totalDue: 30000, paymentsReceived: 15000, statementDate: new Date() }),
      ]);

      const result = useCreditCardStore.getState().getPaymentBehavior(6);
      expect(result.fullPayRate).toBe(0.5);
    });

    it('calculates on-time rate based on late fee presence', () => {
      useCreditCardStore.getState().addStatements([
        makeStatement({ id: 's1', lateFee: 0, statementDate: new Date() }),
        makeStatement({ id: 's2', lateFee: 500, statementDate: new Date() }),
      ]);

      const result = useCreditCardStore.getState().getPaymentBehavior(6);
      expect(result.onTimeRate).toBe(0.5);
    });

    it('calculates total interest paid', () => {
      useCreditCardStore.getState().addStatements([
        makeStatement({ id: 's1', interestCharged: 1500, statementDate: new Date() }),
        makeStatement({ id: 's2', interestCharged: 2000, statementDate: new Date() }),
      ]);

      const result = useCreditCardStore.getState().getPaymentBehavior(6);
      expect(result.totalInterestPaid).toBe(3500);
    });
  });

  describe('getFinancialHealthScore', () => {
    it('weights utilization at 40%, fullPay at 35%, onTime at 15%, spending at 10%', () => {
      useCreditCardStore.getState().addStatement(
        makeStatement({ totalDue: 10000, creditLimit: 200000, paymentsReceived: 10000, lateFee: 0, statementDate: new Date() }),
      );

      const result = useCreditCardStore.getState().getFinancialHealthScore([], 50000, 30000);
      expect(result.score).toBeGreaterThan(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.components.utilization.score).toBe(100); // <10% utilization
      expect(result.components.fullPayRate.score).toBe(100); // full pay
    });

    it('penalizes high utilization', () => {
      useCreditCardStore.getState().addStatement(
        makeStatement({ totalDue: 150000, creditLimit: 200000, paymentsReceived: 150000, lateFee: 0, statementDate: new Date() }),
      );

      const result = useCreditCardStore.getState().getFinancialHealthScore([], 50000, 30000);
      expect(result.components.utilization.score).toBeLessThan(70);
    });
  });

  describe('getCashbackAnalysis', () => {
    it('calculates total cashback across cards', () => {
      useCreditCardStore.getState().addStatements([
        makeStatement({ id: 's1', cardIssuer: 'HDFC', cardLastFour: '1234', cashbackEarned: 500, purchasesAndCharges: 50000, statementDate: new Date('2024-01-15') }),
        makeStatement({ id: 's2', cardIssuer: 'HDFC', cardLastFour: '1234', cashbackEarned: 300, purchasesAndCharges: 30000, statementDate: new Date('2024-02-15') }),
      ]);

      const result = useCreditCardStore.getState().getCashbackAnalysis();
      expect(result.totalCashbackAllCards).toBe(800);
      expect(result.byCard).toHaveLength(1);
      expect(result.byCard[0].averageCashbackRate).toBeCloseTo(800 / 80000);
    });

    it('handles zero spend without division error', () => {
      useCreditCardStore.getState().addStatement(
        makeStatement({ purchasesAndCharges: 0, cashbackEarned: 0 }),
      );

      const result = useCreditCardStore.getState().getCashbackAnalysis();
      expect(result.byCard[0].averageCashbackRate).toBe(0);
    });

    it('identifies best card by cashback rate', () => {
      useCreditCardStore.getState().addStatements([
        makeStatement({ cardIssuer: 'HDFC', cardLastFour: '1234', cashbackEarned: 500, purchasesAndCharges: 50000, statementDate: new Date('2024-01-15') }),
        makeStatement({ cardIssuer: 'SBI', cardLastFour: '5678', cashbackEarned: 1000, purchasesAndCharges: 20000, statementDate: new Date('2024-01-15') }),
      ]);

      const result = useCreditCardStore.getState().getCashbackAnalysis();
      expect(result.bestCard).toBeDefined();
      expect(result.bestCard!.issuer).toBe('SBI');
    });
  });

  describe('getInterestProjections', () => {
    it('generates real projections for cards with debt', () => {
      useCreditCardStore.getState().addStatement(makeStatement({ totalDue: 50000 }));

      const result = useCreditCardStore.getState().getInterestProjections();

      expect(result).toHaveLength(1);
      expect(result[0].cardIssuer).toBe('HDFC');
      expect(result[0].cardLastFour).toBe('1234');
      expect(result[0].currentBalance).toBe(50000);
      expect(result[0].apr).toBeGreaterThan(0);
      expect(result[0].minimumPayoff.monthsToPayoff).toBeGreaterThan(0);
      expect(result[0].fullPaySavings).toBeGreaterThan(0);
    });

    it('skips cards with zero balance', () => {
      useCreditCardStore.getState().addStatement(makeStatement({ totalDue: 0 }));
      expect(useCreditCardStore.getState().getInterestProjections()).toHaveLength(0);
    });
  });

  describe('getPaymentRecommendations', () => {
    it('allocates full payment to single card via avalanche', () => {
      useCreditCardStore.getState().addStatement(makeStatement({ totalDue: 50000 }));

      const result = useCreditCardStore.getState().getPaymentRecommendations(10000, 'avalanche');

      expect(result.strategy).toBe('avalanche');
      expect(result.totalDebt).toBe(50000);
      expect(result.availableForPayment).toBe(10000);
      expect(result.cardPayments).toHaveLength(1);
      expect(result.cardPayments[0].recommendedPayment).toBe(10000);
    });

    it('allocates full payment to single card via snowball', () => {
      useCreditCardStore.getState().addStatement(makeStatement({ totalDue: 50000 }));

      const result = useCreditCardStore.getState().getPaymentRecommendations(10000, 'snowball');

      expect(result.strategy).toBe('snowball');
      expect(result.cardPayments).toHaveLength(1);
      expect(result.cardPayments[0].recommendedPayment).toBe(10000);
    });
  });

  describe('getDebtTrapAnalysis', () => {
    it('returns none risk for fully-paid cards', () => {
      useCreditCardStore.getState().addStatements([
        makeStatement({ id: 's1', statementDate: new Date('2024-01-15'), totalDue: 50000, paymentsReceived: 50000 }),
        makeStatement({ id: 's2', statementDate: new Date('2024-02-15'), totalDue: 50000, paymentsReceived: 50000 }),
      ]);

      const result = useCreditCardStore.getState().getDebtTrapAnalysis();

      expect(result.cards).toHaveLength(1);
      expect(result.cards[0].riskLevel).toBe('none');
      expect(result.overallRiskLevel).toBe('none');
      expect(result.totalRevolvingDebt).toBe(0);
    });
  });

  describe('getRewardPointsAnalysis', () => {
    it('aggregates reward points across statements', () => {
      useCreditCardStore.getState().addStatements([
        makeStatement({
          id: 's1',
          cardIssuer: 'HDFC',
          cardLastFour: '1234',
          purchasesAndCharges: 50000,
          rewardPoints: {
            openingBalance: 1000,
            earned: 500,
            redeemed: 200,
            expired: 0,
            closingBalance: 1300,
            expiringNext: 100,
            expiringNextDate: new Date('2030-06-01'),
          },
        }),
      ]);

      const result = useCreditCardStore.getState().getRewardPointsAnalysis();
      expect(result.totalPointsAllCards).toBe(1300);
      expect(result.byCard).toHaveLength(1);
      expect(result.byCard[0].totalEarned).toBe(500);
      expect(result.byCard[0].totalRedeemed).toBe(200);
    });

    it('tracks expiring points within 90-day window', () => {
      const soonDate = new Date();
      soonDate.setDate(soonDate.getDate() + 30);

      useCreditCardStore.getState().addStatement(
        makeStatement({
          rewardPoints: {
            openingBalance: 1000,
            earned: 100,
            redeemed: 0,
            expired: 0,
            closingBalance: 1100,
            expiringNext: 200,
            expiringNextDate: soonDate,
          },
        }),
      );

      const result = useCreditCardStore.getState().getRewardPointsAnalysis();
      expect(result.expiringSoon).toHaveLength(1);
      expect(result.expiringSoon[0].points).toBe(200);
    });

    it('does not flag far-future expiry', () => {
      const farDate = new Date();
      farDate.setFullYear(farDate.getFullYear() + 1);

      useCreditCardStore.getState().addStatement(
        makeStatement({
          rewardPoints: {
            openingBalance: 1000,
            earned: 100,
            redeemed: 0,
            expired: 0,
            closingBalance: 1100,
            expiringNext: 200,
            expiringNextDate: farDate,
          },
        }),
      );

      const result = useCreditCardStore.getState().getRewardPointsAnalysis();
      expect(result.expiringSoon).toHaveLength(0);
    });

    it('returns zeroed result when no reward points data', () => {
      useCreditCardStore.getState().addStatement(makeStatement());
      const result = useCreditCardStore.getState().getRewardPointsAnalysis();
      expect(result.totalPointsAllCards).toBe(0);
      expect(result.byCard).toHaveLength(0);
    });
  });
});
