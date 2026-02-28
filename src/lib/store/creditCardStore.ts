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
} from '@/types/creditCard';
import { Transaction } from '@/types';

/** Ensure a value is a proper Date object */
function toDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v);
}

/** Rehydrate date fields in a statement */
function rehydrateStatement(stmt: CreditCardStatement): CreditCardStatement {
  return {
    ...stmt,
    parseDate: toDate(stmt.parseDate),
    statementPeriod: {
      start: toDate(stmt.statementPeriod.start),
      end: toDate(stmt.statementPeriod.end),
    },
    statementDate: toDate(stmt.statementDate),
    paymentDueDate: toDate(stmt.paymentDueDate),
  };
}

interface CreditCardStore {
  statements: CreditCardStatement[];
  isParsing: boolean;

  // Actions
  addStatement: (statement: CreditCardStatement) => void;
  addStatements: (statements: CreditCardStatement[]) => void;
  clearStatements: () => void;

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
          if (recent) {
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
