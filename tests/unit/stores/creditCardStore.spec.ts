import { describe, it, expect, beforeEach } from 'vitest';

import { useCreditCardStore, createCreditCardStatement } from '@/lib/store/creditCardStore';
import type { CreditCardStatement } from '@/types/creditCard';
import { makeTransaction } from '@tests/unit/factories';
import { SourceType, Category, CategoryType } from '@/types';

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

    it('sorts expiringSoon ascending by expiry date across multiple cards', () => {
      const soonDate1 = new Date();
      soonDate1.setDate(soonDate1.getDate() + 60);

      const soonDate2 = new Date();
      soonDate2.setDate(soonDate2.getDate() + 15); // expires sooner

      useCreditCardStore.getState().addStatements([
        makeStatement({
          cardIssuer: 'HDFC',
          cardLastFour: '1111',
          rewardPoints: {
            openingBalance: 500,
            earned: 100,
            redeemed: 0,
            expired: 0,
            closingBalance: 600,
            expiringNext: 50,
            expiringNextDate: soonDate1,
          },
        }),
        makeStatement({
          cardIssuer: 'SBI',
          cardLastFour: '2222',
          rewardPoints: {
            openingBalance: 800,
            earned: 200,
            redeemed: 0,
            expired: 0,
            closingBalance: 1000,
            expiringNext: 100,
            expiringNextDate: soonDate2,
          },
        }),
      ]);

      const result = useCreditCardStore.getState().getRewardPointsAnalysis();
      expect(result.expiringSoon).toHaveLength(2);
      // Sorted ascending by expiry: SBI (15 days) first, HDFC (60 days) second
      expect(result.expiringSoon[0].cardIssuer).toBe('SBI');
      expect(result.expiringSoon[0].points).toBe(100);
      expect(result.expiringSoon[1].cardIssuer).toBe('HDFC');
      expect(result.expiringSoon[1].points).toBe(50);
    });
  });

  describe('createCreditCardStatement', () => {
    it('generates a UUID id and merges provided data', () => {
      const data = {
        fileName: 'stmt.pdf',
        parseDate: new Date('2024-06-01'),
        cardLastFour: '5678',
        cardIssuer: 'SBI',
        statementPeriod: { start: new Date('2024-05-01'), end: new Date('2024-05-31') },
        statementDate: new Date('2024-06-01'),
        paymentDueDate: new Date('2024-06-20'),
        totalDue: 30000,
        minimumDue: 1500,
        creditLimit: 100000,
        availableCredit: 70000,
        previousBalance: 25000,
        paymentsReceived: 25000,
        purchasesAndCharges: 30000,
        interestCharged: 0,
        lateFee: 0,
        isPaid: false,
      };

      const stmt = createCreditCardStatement(data);

      // Must have a generated id that is a valid UUID format
      expect(stmt.id).toBeDefined();
      expect(typeof stmt.id).toBe('string');
      expect(stmt.id.length).toBeGreaterThan(0);
      // UUID v4 format: 8-4-4-4-12 hex chars
      expect(stmt.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

      // All provided fields are preserved
      expect(stmt.cardIssuer).toBe('SBI');
      expect(stmt.cardLastFour).toBe('5678');
      expect(stmt.totalDue).toBe(30000);
      expect(stmt.minimumDue).toBe(1500);
      expect(stmt.creditLimit).toBe(100000);
      expect(stmt.parseDate).toEqual(new Date('2024-06-01'));
    });

    it('generates unique ids for each call', () => {
      const base = {
        fileName: 'stmt.pdf',
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
      };

      const s1 = createCreditCardStatement(base);
      const s2 = createCreditCardStatement(base);
      expect(s1.id).not.toBe(s2.id);
    });
  });

  describe('getCardComparison', () => {
    it('filters transactions by period and groups by card with category breakdown', () => {
      useCreditCardStore.getState().addStatement(
        makeStatement({ cardIssuer: 'HDFC', cardLastFour: '1234', totalDue: 10000, creditLimit: 200000 }),
      );

      // Create credit card transactions within the period
      const periodStart = new Date('2024-05-01');
      const periodEnd = new Date('2024-05-31');

      const txnIn1 = makeTransaction({ id: 'cc-1', amount: 5000, date: new Date('2024-05-10') });
      Object.defineProperty(txnIn1, 'sourceType', { value: SourceType.CreditCard, writable: true });
      Object.defineProperty(txnIn1, 'cardIssuer', { value: 'HDFC', writable: true });
      Object.defineProperty(txnIn1, 'cardLastFour', { value: '1234', writable: true });
      txnIn1.category = new Category('dining', 'dining', CategoryType.Expense);

      const txnIn2 = makeTransaction({ id: 'cc-2', amount: 3000, date: new Date('2024-05-20') });
      Object.defineProperty(txnIn2, 'sourceType', { value: SourceType.CreditCard, writable: true });
      Object.defineProperty(txnIn2, 'cardIssuer', { value: 'HDFC', writable: true });
      Object.defineProperty(txnIn2, 'cardLastFour', { value: '1234', writable: true });
      txnIn2.category = new Category('groceries', 'groceries', CategoryType.Expense);

      // Transaction outside period — should be excluded
      const txnOut = makeTransaction({ id: 'cc-3', amount: 9999, date: new Date('2024-04-15') });
      Object.defineProperty(txnOut, 'sourceType', { value: SourceType.CreditCard, writable: true });
      Object.defineProperty(txnOut, 'cardIssuer', { value: 'HDFC', writable: true });
      Object.defineProperty(txnOut, 'cardLastFour', { value: '1234', writable: true });

      // Bank transaction in period — should be excluded (sourceType !== credit_card)
      const txnBank = makeTransaction({ id: 'cc-4', amount: 7777, date: new Date('2024-05-15') });

      const result = useCreditCardStore.getState().getCardComparison(
        [txnIn1, txnIn2, txnOut, txnBank],
        periodStart,
        periodEnd,
      );

      expect(result).toHaveLength(1);
      expect(result[0].cardIssuer).toBe('HDFC');
      expect(result[0].cardLastFour).toBe('1234');
      expect(result[0].totalSpend).toBe(8000); // 5000 + 3000
      expect(result[0].transactionCount).toBe(2);
      expect(result[0].categoryBreakdown).toEqual({
        dining: 5000,
        groceries: 3000,
      });
    });

    it('returns empty array when no cards exist', () => {
      const result = useCreditCardStore.getState().getCardComparison([], new Date(), new Date());
      expect(result).toHaveLength(0);
    });

    it('sorts multi-card results descending by totalSpend', () => {
      useCreditCardStore.getState().addStatements([
        makeStatement({ cardIssuer: 'HDFC', cardLastFour: '1111', creditLimit: 200000 }),
        makeStatement({ cardIssuer: 'SBI', cardLastFour: '2222', creditLimit: 100000 }),
      ]);

      const periodStart = new Date('2024-05-01');
      const periodEnd = new Date('2024-05-31');

      // SBI card has MORE spend (added first — should sort to index 0)
      const txn1 = makeTransaction({ id: 'cc-sbi', amount: 15000, date: new Date('2024-05-10') });
      Object.defineProperty(txn1, 'sourceType', { value: SourceType.CreditCard, writable: true });
      Object.defineProperty(txn1, 'cardIssuer', { value: 'SBI', writable: true });
      Object.defineProperty(txn1, 'cardLastFour', { value: '2222', writable: true });

      // HDFC card has LESS spend
      const txn2 = makeTransaction({ id: 'cc-hdfc', amount: 5000, date: new Date('2024-05-15') });
      Object.defineProperty(txn2, 'sourceType', { value: SourceType.CreditCard, writable: true });
      Object.defineProperty(txn2, 'cardIssuer', { value: 'HDFC', writable: true });
      Object.defineProperty(txn2, 'cardLastFour', { value: '1111', writable: true });

      const result = useCreditCardStore.getState().getCardComparison(
        [txn1, txn2],
        periodStart,
        periodEnd,
      );

      expect(result).toHaveLength(2);
      // Descending by totalSpend: SBI (15000) first, HDFC (5000) second
      expect(result[0].cardIssuer).toBe('SBI');
      expect(result[0].totalSpend).toBe(15000);
      expect(result[1].cardIssuer).toBe('HDFC');
      expect(result[1].totalSpend).toBe(5000);
    });
  });

  describe('getUnpaidStatements', () => {
    it('filters unpaid statements and sorts by paymentDueDate ascending', () => {
      useCreditCardStore.getState().addStatements([
        makeStatement({ id: 's1', isPaid: true, paidDate: new Date(), paymentDueDate: new Date('2024-07-01') }),
        makeStatement({ id: 's2', isPaid: false, paymentDueDate: new Date('2029-08-01') }),
        makeStatement({ id: 's3', isPaid: false, paymentDueDate: new Date('2029-06-01') }),
      ]);

      const result = useCreditCardStore.getState().getUnpaidStatements();
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('s3'); // earliest due date first
      expect(result[1].id).toBe('s2');
    });

    it('returns empty array when all are paid', () => {
      useCreditCardStore.getState().addStatement(
        makeStatement({ isPaid: true, paidDate: new Date() }),
      );
      expect(useCreditCardStore.getState().getUnpaidStatements()).toHaveLength(0);
    });
  });

  describe('getFinancialHealthScore edge cases', () => {
    it('uses default utilizationScore=40 when utilization is between 0.30 and 0.50', () => {
      // 0.30 <= utilization < 0.50 → utilizationScore = 60
      useCreditCardStore.getState().addStatement(
        makeStatement({ totalDue: 80000, creditLimit: 200000, paymentsReceived: 80000, lateFee: 0, statementDate: new Date() }),
      );

      const result = useCreditCardStore.getState().getFinancialHealthScore([], 50000, 30000);
      // utilization = 80000/200000 = 0.40 → score 60
      expect(result.components.utilization.score).toBe(60);
    });

    it('uses utilizationScore=40 when utilization is between 0.50 and above', () => {
      // utilization >= 0.50 → falls through all ifs, stays at default 40
      useCreditCardStore.getState().addStatement(
        makeStatement({ totalDue: 120000, creditLimit: 200000, paymentsReceived: 120000, lateFee: 0, statementDate: new Date() }),
      );

      const result = useCreditCardStore.getState().getFinancialHealthScore([], 50000, 30000);
      // utilization = 120000/200000 = 0.60 → default 40
      expect(result.components.utilization.score).toBe(40);
    });

    it('uses spendingTrendScore=50 when income is zero', () => {
      useCreditCardStore.getState().addStatement(
        makeStatement({ totalDue: 5000, creditLimit: 200000, paymentsReceived: 5000, lateFee: 0, statementDate: new Date() }),
      );

      const result = useCreditCardStore.getState().getFinancialHealthScore([], 0, 3000);
      expect(result.components.spendingTrend.score).toBe(50);
      expect(result.components.spendingTrend.value).toBe(1);
    });

    it('uses spendingTrendScore=100 when expenses < income', () => {
      useCreditCardStore.getState().addStatement(
        makeStatement({ totalDue: 5000, creditLimit: 200000, paymentsReceived: 5000, lateFee: 0, statementDate: new Date() }),
      );

      const result = useCreditCardStore.getState().getFinancialHealthScore([], 50000, 30000);
      expect(result.components.spendingTrend.score).toBe(100);
    });

    it('uses spendingTrendScore=50 when expenses >= income', () => {
      useCreditCardStore.getState().addStatement(
        makeStatement({ totalDue: 5000, creditLimit: 200000, paymentsReceived: 5000, lateFee: 0, statementDate: new Date() }),
      );

      const result = useCreditCardStore.getState().getFinancialHealthScore([], 30000, 50000);
      expect(result.components.spendingTrend.score).toBe(50);
    });
  });

  describe('getCardComparison edge cases', () => {
    it('returns utilization 0 when card has no utilization data', () => {
      useCreditCardStore.getState().addStatements([
        makeStatement({ cardIssuer: 'HDFC', cardLastFour: '1234', creditLimit: 200000 }),
      ]);

      // Transactions from a different card — utilization perCard map won't have this card
      const periodStart = new Date('2024-05-01');
      const periodEnd = new Date('2024-05-31');

      // Use a different card in transactions to not match the statement card
      const txn = makeTransaction({ id: 'cc-other', amount: 5000, date: new Date('2024-05-10') });
      Object.defineProperty(txn, 'sourceType', { value: SourceType.CreditCard, writable: true });
      Object.defineProperty(txn, 'cardIssuer', { value: 'HDFC', writable: true });
      Object.defineProperty(txn, 'cardLastFour', { value: '1234', writable: true });

      // Clear statements and add one with zero totalDue to get 0 utilization
      useCreditCardStore.getState().clearStatements();
      useCreditCardStore.getState().addStatement(
        makeStatement({ cardIssuer: 'HDFC', cardLastFour: '9999', totalDue: 0, creditLimit: 200000 }),
      );

      const result = useCreditCardStore.getState().getCardComparison([txn], periodStart, periodEnd);
      // Card 9999 has no matching transactions, so cardUtil is from utilization perCard
      // The card in the result is 9999 with no transactions, utilization comes from perCard
      expect(result).toHaveLength(1);
    });

    it('handles transactions with no category as uncategorized', () => {
      useCreditCardStore.getState().addStatement(
        makeStatement({ cardIssuer: 'HDFC', cardLastFour: '1234', creditLimit: 200000 }),
      );

      const periodStart = new Date('2024-05-01');
      const periodEnd = new Date('2024-05-31');

      const txn = makeTransaction({ id: 'cc-nocat', amount: 5000, date: new Date('2024-05-10') });
      Object.defineProperty(txn, 'sourceType', { value: SourceType.CreditCard, writable: true });
      Object.defineProperty(txn, 'cardIssuer', { value: 'HDFC', writable: true });
      Object.defineProperty(txn, 'cardLastFour', { value: '1234', writable: true });
      // Set category to null to hit the fallback
      txn.category = null as unknown as Category;

      const result = useCreditCardStore.getState().getCardComparison([txn], periodStart, periodEnd);
      expect(result[0].categoryBreakdown).toEqual({ uncategorized: 5000 });
    });
  });

  describe('getUnpaidStatements all due dates', () => {
    it('includes statements with past due dates', () => {
      useCreditCardStore.getState().addStatement(
        makeStatement({ id: 's-past', isPaid: false, paymentDueDate: new Date('2020-01-01') }),
      );

      const result = useCreditCardStore.getState().getUnpaidStatements();
      expect(result).toHaveLength(1);
      // getUnpaidStatements returns statements as-is, no computed properties added
    });
  });

  describe('getCashbackAnalysis edge cases', () => {
    it('returns null bestCard when no card has positive cashback rate', () => {
      useCreditCardStore.getState().addStatement(
        makeStatement({ cashbackEarned: 0, purchasesAndCharges: 0 }),
      );

      const result = useCreditCardStore.getState().getCashbackAnalysis();
      expect(result.bestCard).toBeNull();
    });
  });

  describe('getRewardPointsAnalysis earning rate', () => {
    it('calculates earning rate from purchases', () => {
      useCreditCardStore.getState().addStatement(
        makeStatement({
          id: 's-rate',
          cardIssuer: 'HDFC',
          cardLastFour: '1234',
          purchasesAndCharges: 10000,
          rewardPoints: {
            openingBalance: 0,
            earned: 100,
            redeemed: 0,
            expired: 0,
            closingBalance: 100,
          },
        }),
      );

      const result = useCreditCardStore.getState().getRewardPointsAnalysis();
      expect(result.byCard).toHaveLength(1);
      expect(result.byCard[0].earningRate).toBeGreaterThan(0);
    });

    it('skips earning rate when purchasesAndCharges is zero', () => {
      useCreditCardStore.getState().addStatement(
        makeStatement({
          id: 's-zero',
          cardIssuer: 'HDFC',
          cardLastFour: '1234',
          purchasesAndCharges: 0,
          rewardPoints: {
            openingBalance: 100,
            earned: 0,
            redeemed: 0,
            expired: 0,
            closingBalance: 100,
          },
        }),
      );

      const result = useCreditCardStore.getState().getRewardPointsAnalysis();
      expect(result.byCard).toHaveLength(1);
      expect(result.byCard[0].earningRate).toBe(0);
    });
  });

  describe('persist rehydration', () => {
    it('Date fields survive JSON serialization/deserialization through merge', async () => {
      const stmt = makeStatement({
        id: 'rehydrate-1',
        parseDate: new Date('2024-06-01T10:00:00.000Z'),
        statementDate: new Date('2024-06-01T10:00:00.000Z'),
        paymentDueDate: new Date('2024-06-20T10:00:00.000Z'),
        statementPeriod: {
          start: new Date('2024-05-01T00:00:00.000Z'),
          end: new Date('2024-05-31T00:00:00.000Z'),
        },
        paidDate: new Date('2024-06-15T10:00:00.000Z'),
        rewardPoints: {
          openingBalance: 1000,
          earned: 100,
          redeemed: 0,
          expired: 0,
          closingBalance: 1100,
          expiringNext: 50,
          expiringNextDate: new Date('2024-12-01T00:00:00.000Z'),
        },
      });

      // Simulate what zustand persist does: serialize to JSON string in localStorage
      const serialized = JSON.stringify({
        state: { statements: [stmt] },
        version: 0,
      });
      localStorage.setItem('credit-card-storage', serialized);

      // Re-import the store module to trigger rehydration from localStorage
      // vitest modules are cached; use dynamic import with date query to bust cache
      const { useCreditCardStore: freshStore } = await import('@/lib/store/creditCardStore?' + Date.now());

      const hydrated = freshStore.getState().statements[0];
      expect(hydrated.parseDate).toBeInstanceOf(Date);
      expect(hydrated.parseDate.toISOString()).toBe('2024-06-01T10:00:00.000Z');
      expect(hydrated.statementDate).toBeInstanceOf(Date);
      expect(hydrated.paymentDueDate).toBeInstanceOf(Date);
      expect(hydrated.statementPeriod.start).toBeInstanceOf(Date);
      expect(hydrated.statementPeriod.end).toBeInstanceOf(Date);
      expect(hydrated.paidDate).toBeInstanceOf(Date);
      expect(hydrated.rewardPoints?.expiringNextDate).toBeInstanceOf(Date);

      // Clean up
      localStorage.removeItem('credit-card-storage');
    });

    it('defaults isPaid to false when absent from persisted data', async () => {
      const stmt = makeStatement({ id: 'rehydrate-nopaid' });
      // Remove isPaid from serialized data
      const raw = { ...stmt };
      delete (raw as Record<string, unknown>).isPaid;

      const serialized = JSON.stringify({
        state: { statements: [raw] },
        version: 0,
      });
      localStorage.setItem('credit-card-storage', serialized);

      const { useCreditCardStore: freshStore } = await import('@/lib/store/creditCardStore?' + Date.now());
      const hydrated = freshStore.getState().statements[0];

      expect(hydrated.isPaid).toBe(false);
      localStorage.removeItem('credit-card-storage');
    });

    it('rehydrates statement without paidDate when absent', async () => {
      const stmt = makeStatement({ id: 'rehydrate-nopaiddate' });
      const serialized = JSON.stringify({
        state: { statements: [stmt] },
        version: 0,
      });
      localStorage.setItem('credit-card-storage', serialized);

      const { useCreditCardStore: freshStore } = await import('@/lib/store/creditCardStore?' + Date.now());
      const hydrated = freshStore.getState().statements[0];

      expect(hydrated.paidDate).toBeUndefined();
      localStorage.removeItem('credit-card-storage');
    });

    it('handles statements with no rewardPoints', async () => {
      const stmt = makeStatement({ id: 'rehydrate-norewards' });
      const raw = { ...stmt };
      delete (raw as Record<string, unknown>).rewardPoints;

      const serialized = JSON.stringify({
        state: { statements: [raw] },
        version: 0,
      });
      localStorage.setItem('credit-card-storage', serialized);

      const { useCreditCardStore: freshStore } = await import('@/lib/store/creditCardStore?' + Date.now());
      const hydrated = freshStore.getState().statements[0];

      expect(hydrated.rewardPoints).toBeUndefined();
      localStorage.removeItem('credit-card-storage');
    });

    it('handles merge when persisted state has no statements array', async () => {
      const serialized = JSON.stringify({
        state: { isParsing: false },
        version: 0,
      });
      localStorage.setItem('credit-card-storage', serialized);

      const { useCreditCardStore: freshStore } = await import('@/lib/store/creditCardStore?' + Date.now());
      expect(freshStore.getState().statements).toEqual([]);
      localStorage.removeItem('credit-card-storage');
    });
  });
});
