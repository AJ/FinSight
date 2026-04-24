import { describe, it, expect } from 'vitest';
import { analyzeRevolvingBalance, calculateDebtTrapAnalysis } from '@/lib/creditCard/revolvingDetector';
import type { CreditCardStatement } from '@/types/creditCard';

function makeStatement(overrides: Partial<CreditCardStatement> = {}): CreditCardStatement {
  return {
    cardIssuer: 'HDFC',
    cardLastFour: '1234',
    statementDate: new Date('2024-01-31'),
    totalDue: 25000,
    minimumDue: 2500,
    paymentsReceived: 25000,
    interestCharged: 0,
    ...overrides,
  } as CreditCardStatement;
}

describe('analyzeRevolvingBalance', () => {
  it('detects revolving pattern (payments < total due)', () => {
    const statements = Array.from({ length: 6 }, (_, i) =>
      makeStatement({
        statementDate: new Date(`2024-${String(i + 1).padStart(2, '0')}-28`),
        totalDue: 25000,
        paymentsReceived: 2500, // Paying only minimum
      })
    );
    const result = analyzeRevolvingBalance(statements);
    expect(result.isRevolving).toBe(true);
    expect(result.paysMinimumOnly).toBe(true);
    expect(result.riskLevel).not.toBe('none');
  });

  it('detects no revolving for full payments', () => {
    const statements = Array.from({ length: 6 }, (_, i) =>
      makeStatement({
        statementDate: new Date(`2024-${String(i + 1).padStart(2, '0')}-28`),
        totalDue: 25000,
        paymentsReceived: 25000,
      })
    );
    const result = analyzeRevolvingBalance(statements);
    expect(result.isRevolving).toBe(false);
    expect(result.riskLevel).toBe('none');
  });

  it('detects balance increasing trend', () => {
    const statements = Array.from({ length: 6 }, (_, i) =>
      makeStatement({
        statementDate: new Date(`2024-${String(i + 1).padStart(2, '0')}-28`),
        totalDue: 20000 + i * 5000,
        paymentsReceived: 2500,
      })
    );
    const result = analyzeRevolvingBalance(statements);
    expect(result.balanceIncreasing).toBe(true);
  });

  it('handles empty statements', () => {
    const result = analyzeRevolvingBalance([]);
    expect(result.isRevolving).toBe(false);
    expect(result.riskLevel).toBe('none');
  });
});

describe('calculateDebtTrapAnalysis', () => {
  it('generates recommendations for high-risk cards', () => {
    const statements = Array.from({ length: 6 }, (_, i) =>
      makeStatement({
        cardIssuer: 'HDFC',
        cardLastFour: '1111',
        statementDate: new Date(`2024-${String(i + 1).padStart(2, '0')}-28`),
        totalDue: 25000,
        minimumDue: 2500,
        paymentsReceived: 2500,
      })
    );
    const result = calculateDebtTrapAnalysis(statements);
    expect(result.cards).toHaveLength(1);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it('detects critical risk for 2+ high-risk cards', () => {
    const statements = [
      ...Array.from({ length: 6 }, (_, i) => makeStatement({
        cardIssuer: 'HDFC', cardLastFour: '1111',
        statementDate: new Date(`2024-${String(i + 1).padStart(2, '0')}-28`),
        totalDue: 50000, paymentsReceived: 2500,
      })),
      ...Array.from({ length: 6 }, (_, i) => makeStatement({
        cardIssuer: 'ICICI', cardLastFour: '2222',
        statementDate: new Date(`2024-${String(i + 1).padStart(2, '0')}-28`),
        totalDue: 50000, paymentsReceived: 2500,
      })),
    ];
    const result = calculateDebtTrapAnalysis(statements);
    expect(result.overallRiskLevel).toBe('critical');
  });

  it('handles empty input', () => {
    const result = calculateDebtTrapAnalysis([]);
    expect(result.cards).toHaveLength(0);
    expect(result.overallRiskLevel).toBe('none');
  });
});
