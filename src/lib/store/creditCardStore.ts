import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import {
  CreditCardStatement,
  PaymentBehavior,
  FinancialHealthScore,
  DueDateItem,
  UtilizationResult,
  CardComparison,
  InterestProjection,
  PaymentStrategy,
  PaymentRecommendation,
  DebtTrapAnalysis,
  CashbackAnalysis,
  RewardPointsAnalysis,
  RewardPointsSummary,
} from '@/types/creditCard';
import { Transaction } from '@/types';
import {
  generateProjection,
} from '@/lib/creditCard/interestCalculator';
import {
  calculateAvalanche,
  calculateSnowball,
} from '@/lib/creditCard/paymentStrategy';
import {
  calculateDebtTrapAnalysis,
} from '@/lib/creditCard/revolvingDetector';
import {
  getAPRForIssuer,
  getPointValueForIssuer,
} from '@/lib/creditCard/constants';

/** Ensure a value is a proper Date object */
function toDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v);
}

/** Rehydrate date fields in a statement */
function rehydrateStatement(stmt: CreditCardStatement): CreditCardStatement {
  const rehydrated: CreditCardStatement = {
    ...stmt,
    parseDate: toDate(stmt.parseDate),
    statementPeriod: {
      start: toDate(stmt.statementPeriod.start),
      end: toDate(stmt.statementPeriod.end),
    },
    statementDate: toDate(stmt.statementDate),
    paymentDueDate: toDate(stmt.paymentDueDate),
    // Ensure isPaid has a default value
    isPaid: stmt.isPaid ?? false,
  };

  // Rehydrate paidDate if present
  if (stmt.paidDate) {
    rehydrated.paidDate = toDate(stmt.paidDate);
  }

  // Rehydrate rewardPoints.expiringNextDate if present
  if (stmt.rewardPoints?.expiringNextDate) {
    rehydrated.rewardPoints = {
      ...stmt.rewardPoints,
      expiringNextDate: toDate(stmt.rewardPoints.expiringNextDate),
    };
  }

  return rehydrated;
}

interface CreditCardStore {
  statements: CreditCardStatement[];
  isParsing: boolean;

  // Actions
  addStatement: (statement: CreditCardStatement) => void;
  addStatements: (statements: CreditCardStatement[]) => void;
  clearStatements: () => void;
  markStatementPaid: (statementId: string, paidDate: Date, paidAmount?: number) => void;
  updateStatement: (statementId: string, updates: Partial<CreditCardStatement>) => void;

  // Queries
  getStatementsByCard: (cardIssuer: string, cardLastFour: string) => CreditCardStatement[];
  getStatementsByIssuer: (issuer: string) => CreditCardStatement[];
  getMostRecentStatement: (cardIssuer: string, cardLastFour: string) => CreditCardStatement | undefined;
  getAllUniqueCards: () => { cardIssuer: string; cardLastFour: string; cardHolder?: string }[];
  getTotalOutstanding: () => number;
  getTotalCreditLimit: () => number;
  getUtilization: () => UtilizationResult;
  getDueDates: () => DueDateItem[];
  getPaymentBehavior: (months: number) => PaymentBehavior;
  getFinancialHealthScore: (transactions: Transaction[], income: number, expenses: number) => FinancialHealthScore;
  getCardComparison: (transactions: Transaction[], periodStart: Date, periodEnd: Date) => CardComparison[];
  // New queries
  getUnpaidStatements: () => CreditCardStatement[];
  getInterestProjections: () => InterestProjection[];
  getPaymentRecommendations: (availableAmount: number, strategy: PaymentStrategy) => PaymentRecommendation;
  getDebtTrapAnalysis: () => DebtTrapAnalysis;
  getCashbackAnalysis: () => CashbackAnalysis;
  getRewardPointsAnalysis: () => RewardPointsAnalysis;
}

export const useCreditCardStore = create<CreditCardStore>()(
  persist(
    (set, get) => ({
      statements: [],
      isParsing: false,

      addStatement: (statement) =>
        set((state) => ({
          statements: [...state.statements, statement],
        })),

      addStatements: (newStatements) =>
        set((state) => ({
          statements: [...state.statements, ...newStatements],
        })),

      clearStatements: () =>
        set({ statements: [] }),

      getStatementsByCard: (cardIssuer, cardLastFour) =>
        get().statements.filter(
          (s) => s.cardIssuer === cardIssuer && s.cardLastFour === cardLastFour
        ),

      getStatementsByIssuer: (issuer) =>
        get().statements.filter((s) => s.cardIssuer === issuer),

      getMostRecentStatement: (cardIssuer, cardLastFour) => {
        const cardStatements = get().getStatementsByCard(cardIssuer, cardLastFour);
        if (cardStatements.length === 0) return undefined;
        return cardStatements.reduce((latest, stmt) =>
          stmt.statementDate > latest.statementDate ? stmt : latest
        );
      },

      getAllUniqueCards: () => {
        const cardMap = new Map<string, { cardIssuer: string; cardLastFour: string; cardHolder?: string }>();

        for (const stmt of get().statements) {
          const key = `${stmt.cardIssuer}-${stmt.cardLastFour}`;
          if (!cardMap.has(key)) {
            cardMap.set(key, {
              cardIssuer: stmt.cardIssuer,
              cardLastFour: stmt.cardLastFour,
              cardHolder: stmt.cardHolder,
            });
          }
        }

        return Array.from(cardMap.values());
      },

      getTotalOutstanding: () => {
        const uniqueCards = get().getAllUniqueCards();
        let total = 0;

        for (const card of uniqueCards) {
          const recent = get().getMostRecentStatement(card.cardIssuer, card.cardLastFour);
          if (recent) {
            total += recent.totalDue;
          }
        }

        return total;
      },

      getTotalCreditLimit: () => {
        const uniqueCards = get().getAllUniqueCards();
        let total = 0;

        for (const card of uniqueCards) {
          const recent = get().getMostRecentStatement(card.cardIssuer, card.cardLastFour);
          if (recent) {
            total += recent.creditLimit;
          }
        }

        return total;
      },

      getUtilization: () => {
        const uniqueCards = get().getAllUniqueCards();
        const perCard = new Map();
        let totalDue = 0;
        let totalLimit = 0;

        for (const card of uniqueCards) {
          const recent = get().getMostRecentStatement(card.cardIssuer, card.cardLastFour);
          if (recent) {
            const utilization = recent.creditLimit > 0 ? recent.totalDue / recent.creditLimit : 0;
            const key = `${card.cardIssuer}-${card.cardLastFour}`;
            perCard.set(key, {
              issuer: card.cardIssuer,
              lastFour: card.cardLastFour,
              utilization,
              totalDue: recent.totalDue,
              creditLimit: recent.creditLimit,
            });
            totalDue += recent.totalDue;
            totalLimit += recent.creditLimit;
          }
        }

        return {
          perCard,
          aggregate: totalLimit > 0 ? totalDue / totalLimit : 0,
          totalDue,
          totalLimit,
        };
      },

      getDueDates: () => {
        const now = new Date();
        const uniqueCards = get().getAllUniqueCards();
        const dueDates: DueDateItem[] = [];

        for (const card of uniqueCards) {
          const recent = get().getMostRecentStatement(card.cardIssuer, card.cardLastFour);
          // Skip if no statement or already paid
          if (!recent || recent.isPaid) continue;

          const dueDate = toDate(recent.paymentDueDate);
          const daysUntilDue = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

          dueDates.push({
            cardIssuer: card.cardIssuer,
            cardLastFour: card.cardLastFour,
            dueDate,
            totalDue: recent.totalDue,
            minimumDue: recent.minimumDue,
            daysUntilDue,
            isOverdue: daysUntilDue < 0,
          });
        }

        return dueDates.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
      },

      getPaymentBehavior: (months) => {
        const { statements } = get();
        const now = new Date();
        const cutoffDate = new Date(now.getFullYear(), now.getMonth() - months, 1);

        const recentStatements = statements.filter(
          (s) => toDate(s.statementDate) >= cutoffDate
        );

        if (recentStatements.length === 0) {
          return {
            fullPayRate: 0,
            onTimeRate: 0,
            totalInterestPaid: 0,
            statementCount: 0,
            period: { start: cutoffDate, end: now },
          };
        }

        // Calculate full pay rate (payment >= totalDue)
        const fullPayCount = recentStatements.filter(
          (s) => s.paymentsReceived >= s.totalDue
        ).length;
        const fullPayRate = fullPayCount / recentStatements.length;

        // Calculate on-time rate (payment received before due date)
        // Note: This is approximate - we don't have exact payment dates
        // We assume payment was on-time if no late fee was charged
        const onTimeCount = recentStatements.filter(
          (s) => !s.lateFee || s.lateFee === 0
        ).length;
        const onTimeRate = onTimeCount / recentStatements.length;

        // Calculate total interest paid
        const totalInterestPaid = recentStatements.reduce(
          (sum, s) => sum + (s.interestCharged || 0),
          0
        );

        return {
          fullPayRate,
          onTimeRate,
          totalInterestPaid,
          statementCount: recentStatements.length,
          period: { start: cutoffDate, end: now },
        };
      },

      getFinancialHealthScore: (transactions, income, expenses) => {
        const utilization = get().getUtilization();
        const paymentBehavior = get().getPaymentBehavior(12);

        // Utilization score (40% weight)
        let utilizationScore = 40; // Default
        if (utilization.aggregate < 0.10) utilizationScore = 100;
        else if (utilization.aggregate < 0.30) utilizationScore = 80;
        else if (utilization.aggregate < 0.50) utilizationScore = 60;

        // Full pay rate score (35% weight)
        const fullPayScore = paymentBehavior.fullPayRate * 100;

        // On-time rate score (15% weight)
        const onTimeScore = paymentBehavior.onTimeRate * 100;

        // Spending trend score (10% weight)
        let spendingTrendScore = 50;
        let spendingTrendValue = 1;
        if (income > 0) {
          spendingTrendValue = expenses / income;
          spendingTrendScore = spendingTrendValue < 1 ? 100 : 50;
        }

        // Calculate weighted total
        const score = Math.round(
          utilizationScore * 0.40 +
          fullPayScore * 0.35 +
          onTimeScore * 0.15 +
          spendingTrendScore * 0.10
        );

        return {
          score,
          components: {
            utilization: { value: utilization.aggregate, score: utilizationScore },
            fullPayRate: { value: paymentBehavior.fullPayRate, score: fullPayScore },
            onTimeRate: { value: paymentBehavior.onTimeRate, score: onTimeScore },
            spendingTrend: { value: spendingTrendValue, score: spendingTrendScore },
          },
          calculatedAt: new Date(),
        };
      },

      getCardComparison: (transactions, periodStart, periodEnd) => {
        const uniqueCards = get().getAllUniqueCards();
        const utilization = get().getUtilization();

        // Filter transactions by period
        const periodTxns = transactions.filter((t) => {
          const date = toDate(t.date);
          return date >= periodStart && date <= periodEnd && t.sourceType === 'credit_card';
        });

        return uniqueCards.map((card) => {
          const key = `${card.cardIssuer}-${card.cardLastFour}`;
          const cardTxns = periodTxns.filter(
            (t) => t.cardIssuer === card.cardIssuer && t.cardLastFour === card.cardLastFour
          );

          const totalSpend = cardTxns.reduce((sum, t) => sum + Math.abs(t.amount), 0);
          const categoryBreakdown: Record<string, number> = {};

          for (const txn of cardTxns) {
            const cat = txn.category?.id || 'uncategorized';
            categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + Math.abs(txn.amount);
          }

          const cardUtil = utilization.perCard.get(key);

          return {
            cardIssuer: card.cardIssuer,
            cardLastFour: card.cardLastFour,
            cardLabel: `${card.cardIssuer} ****${card.cardLastFour}`,
            totalSpend,
            transactionCount: cardTxns.length,
            utilization: cardUtil?.utilization || 0,
            categoryBreakdown,
          };
        }).sort((a, b) => b.totalSpend - a.totalSpend);
      },

      // New actions
      markStatementPaid: (statementId, paidDate, paidAmount) =>
        set((state) => ({
          statements: state.statements.map((s) =>
            s.id === statementId
              ? { ...s, isPaid: true, paidDate, paidAmount: paidAmount ?? s.totalDue }
              : s
          ),
        })),

      updateStatement: (statementId, updates) =>
        set((state) => ({
          statements: state.statements.map((s) =>
            s.id === statementId ? { ...s, ...updates } : s
          ),
        })),

      // New queries
      getUnpaidStatements: () => {
        const { statements } = get();
        const now = new Date();
        return statements
          .filter((s) => !s.isPaid)
          .filter((s) => toDate(s.paymentDueDate) >= now || toDate(s.paymentDueDate) < now)
          .sort((a, b) => toDate(a.paymentDueDate).getTime() - toDate(b.paymentDueDate).getTime());
      },

      getInterestProjections: () => {
        const uniqueCards = get().getAllUniqueCards();
        const projections: InterestProjection[] = [];

        for (const card of uniqueCards) {
          const recent = get().getMostRecentStatement(card.cardIssuer, card.cardLastFour);
          if (recent && recent.totalDue > 0) {
            const apr = getAPRForIssuer(card.cardIssuer, recent.apr);
            projections.push(generateProjection(recent, apr));
          }
        }

        return projections;
      },

      getPaymentRecommendations: (availableAmount, strategy) => {
        const uniqueCards = get().getAllUniqueCards();
        const cardsWithDebt = uniqueCards
          .map((card) => {
            const recent = get().getMostRecentStatement(card.cardIssuer, card.cardLastFour);
            return {
              issuer: card.cardIssuer,
              lastFour: card.cardLastFour,
              balance: recent?.totalDue ?? 0,
              apr: recent ? getAPRForIssuer(card.cardIssuer, recent.apr) : 0.408,
            };
          })
          .filter((c) => c.balance > 0);

        if (strategy === 'avalanche') {
          return calculateAvalanche(cardsWithDebt, availableAmount);
        }
        return calculateSnowball(cardsWithDebt, availableAmount);
      },

      getDebtTrapAnalysis: () => {
        const { statements } = get();
        return calculateDebtTrapAnalysis(statements);
      },

      getCashbackAnalysis: () => {
        const { statements } = get();
        const byCard = new Map<string, { cashback: number; spend: number; periods: Map<string, number> }>();

        for (const stmt of statements) {
          const key = `${stmt.cardIssuer}-${stmt.cardLastFour}`;
          if (!byCard.has(key)) {
            byCard.set(key, { cashback: 0, spend: 0, periods: new Map() });
          }
          const card = byCard.get(key)!;
          card.cashback += stmt.cashbackEarned ?? 0;
          card.spend += stmt.purchasesAndCharges;

          const period = `${toDate(stmt.statementDate).getFullYear()}-${String(toDate(stmt.statementDate).getMonth() + 1).padStart(2, '0')}`;
          card.periods.set(period, (card.periods.get(period) ?? 0) + (stmt.cashbackEarned ?? 0));
        }

        const byCardArray = Array.from(byCard.entries()).map(([key, data]) => {
          const [issuer, lastFour] = key.split('-');
          return {
            cardIssuer: issuer,
            cardLastFour: lastFour,
            totalCashback: data.cashback,
            cashbackByPeriod: Array.from(data.periods.entries())
              .map(([period, cashback]) => ({ period, cashback }))
              .sort((a, b) => a.period.localeCompare(b.period)),
            averageCashbackRate: data.spend > 0 ? data.cashback / data.spend : 0,
          };
        });

        const totalCashbackAllCards = byCardArray.reduce((sum, c) => sum + c.totalCashback, 0);
        const sortedByRate = [...byCardArray].sort((a, b) => b.averageCashbackRate - a.averageCashbackRate);
        const bestCard = sortedByRate[0]?.averageCashbackRate > 0
          ? { issuer: sortedByRate[0].cardIssuer, lastFour: sortedByRate[0].cardLastFour, rate: sortedByRate[0].averageCashbackRate }
          : null;

        return {
          totalCashbackAllCards,
          byCard: byCardArray,
          bestCard,
        };
      },

      getRewardPointsAnalysis: () => {
        const { statements } = get();
        const byCard = new Map<string, RewardPointsSummary>();
        const expiringSoon: RewardPointsAnalysis['expiringSoon'] = [];

        for (const stmt of statements) {
          const key = `${stmt.cardIssuer}-${stmt.cardLastFour}`;

          if (stmt.rewardPoints) {
            if (!byCard.has(key)) {
              byCard.set(key, {
                cardIssuer: stmt.cardIssuer,
                cardLastFour: stmt.cardLastFour,
                currentBalance: 0,
                totalEarned: 0,
                totalRedeemed: 0,
                totalExpired: 0,
                earningRate: 0,
                estimatedValue: 0,
              });
            }

            const card = byCard.get(key)!;
            card.currentBalance = stmt.rewardPoints.closingBalance;
            card.totalEarned += stmt.rewardPoints.earned;
            card.totalRedeemed += stmt.rewardPoints.redeemed;
            card.totalExpired += stmt.rewardPoints.expired;

            // Calculate earning rate
            if (stmt.purchasesAndCharges > 0) {
              const periodRate = stmt.rewardPoints.earned / (stmt.purchasesAndCharges / 100);
              card.earningRate = (card.earningRate + periodRate) / 2;
            }

            // Track expiring points
            if (stmt.rewardPoints.expiringNext && stmt.rewardPoints.expiringNextDate) {
              const expDate = toDate(stmt.rewardPoints.expiringNextDate);
              const thirtyDaysFromNow = new Date();
              thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 90);

              if (expDate <= thirtyDaysFromNow) {
                expiringSoon.push({
                  cardIssuer: stmt.cardIssuer,
                  cardLastFour: stmt.cardLastFour,
                  points: stmt.rewardPoints.expiringNext,
                  expiryDate: expDate,
                });
              }
            }
          }
        }

        // Calculate estimated values
        for (const card of byCard.values()) {
          card.estimatedValue = card.currentBalance * getPointValueForIssuer(card.cardIssuer);
        }

        const byCardArray = Array.from(byCard.values());
        const totalPointsAllCards = byCardArray.reduce((sum, c) => sum + c.currentBalance, 0);
        const estimatedTotalValue = byCardArray.reduce((sum, c) => sum + c.estimatedValue, 0);

        return {
          totalPointsAllCards,
          estimatedTotalValue,
          byCard: byCardArray,
          expiringSoon: expiringSoon.sort((a, b) => a.expiryDate.getTime() - b.expiryDate.getTime()),
        };
      },
    }),
    {
      name: 'credit-card-storage',
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.statements = state.statements.map(rehydrateStatement);
        }
      },
    }
  )
);

/**
 * Create a new CreditCardStatement with generated ID
 */
export function createCreditCardStatement(
  data: Omit<CreditCardStatement, 'id'>
): CreditCardStatement {
  return {
    ...data,
    id: uuidv4(),
  };
}
