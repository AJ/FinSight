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

  it('warns when interest charges appear in statements', () => {
    const statements = Array.from({ length: 4 }, (_, i) =>
      makeStatement({
        statementDate: new Date(`2024-${String(i + 1).padStart(2, '0')}-28`),
        totalDue: 25000,
        paymentsReceived: 2500,
        interestCharged: 500,
      })
    );
    const result = analyzeRevolvingBalance(statements);
    expect(result.warnings.some(w => w.includes('Interest charged'))).toBe(true);
  });

  it('returns medium risk for borderline revolving pattern', () => {
    // 4 statements: 3 full pay, 1 revolving → fullPayRate = 0.75 (>= 0.70, < 0.90 → low)
    // But we add balanceIncreasing=true to trigger medium:
    // High: fullPayRate < 0.50? No. consecutiveMonths >= 12? No. balanceIncreasing && consecutiveMonths >= 6? No.
    // Medium: fullPayRate < 0.70? No. consecutiveMonths >= 6? No. balanceIncreasing? Yes → medium
    const statements = [
      makeStatement({ statementDate: new Date('2024-01-28'), totalDue: 10000, paymentsReceived: 10000 }),
      makeStatement({ statementDate: new Date('2024-02-28'), totalDue: 10000, paymentsReceived: 10000 }),
      makeStatement({ statementDate: new Date('2024-03-28'), totalDue: 10000, paymentsReceived: 10000 }),
      makeStatement({ statementDate: new Date('2024-04-28'), totalDue: 20000, paymentsReceived: 5000 }),
    ];
    const result = analyzeRevolvingBalance(statements);
    expect(result.riskLevel).toBe('medium');
  });

  it('returns low risk for mostly full-pay pattern', () => {
    // 5 statements: 4 full pay, 1 partial → fullPayRate = 0.80 (>= 0.70 low, < 0.90 none)
    // consecutive < 3, not increasing → low
    const statements = [
      makeStatement({ statementDate: new Date('2024-01-28'), totalDue: 10000, paymentsReceived: 10000 }),
      makeStatement({ statementDate: new Date('2024-02-28'), totalDue: 10000, paymentsReceived: 10000 }),
      makeStatement({ statementDate: new Date('2024-03-28'), totalDue: 10000, paymentsReceived: 10000 }),
      makeStatement({ statementDate: new Date('2024-04-28'), totalDue: 10000, paymentsReceived: 10000 }),
      makeStatement({ statementDate: new Date('2024-05-28'), totalDue: 10000, paymentsReceived: 5000 }),
    ];
    const result = analyzeRevolvingBalance(statements);
    expect(result.riskLevel).toBe('low');
  });

  it('handles single statement (calculateBalanceTrend returns 0)', () => {
    // With < 2 statements, calculateBalanceTrend returns 0 immediately (line 136)
    const result = analyzeRevolvingBalance([
      makeStatement({ statementDate: new Date('2024-01-28'), totalDue: 10000, paymentsReceived: 10000 }),
    ]);
    expect(result.balanceTrend).toBe(0);
    expect(result.balanceIncreasing).toBe(false);
  });

  it('handles statements with zero average balance in calculateBalanceTrend', () => {
    // When all totalDue = 0, avgY = 0, so the function returns 0 (line 163)
    const statements = Array.from({ length: 4 }, (_, i) =>
      makeStatement({
        statementDate: new Date(`2024-${String(i + 1).padStart(2, '0')}-28`),
        totalDue: 0,
        paymentsReceived: 0,
      })
    );
    const result = analyzeRevolvingBalance(statements);
    expect(result.balanceTrend).toBe(0);
    expect(result.averageBalance).toBe(0);
  });

  it('handles statements where all payments match totalDue exactly (fullPayRate = 1.0)', () => {
    // fullPayRate = 1.0, not increasing, consecutive = 0 → risk level 'none'
    const statements = Array.from({ length: 4 }, (_, i) =>
      makeStatement({
        statementDate: new Date(`2024-${String(i + 1).padStart(2, '0')}-28`),
        totalDue: 10000,
        paymentsReceived: 10000,
      })
    );
    const result = analyzeRevolvingBalance(statements);
    expect(result.riskLevel).toBe('none');
    expect(result.isRevolving).toBe(false);
  });

  it('handles string statementDate via toDate conversion', () => {
    // toDate function (line 19) handles string dates
    const statements = [
      makeStatement({ statementDate: '2024-01-28' as unknown as Date, totalDue: 10000, paymentsReceived: 5000 }),
      makeStatement({ statementDate: '2024-02-28' as unknown as Date, totalDue: 10000, paymentsReceived: 5000 }),
      makeStatement({ statementDate: '2024-03-28' as unknown as Date, totalDue: 10000, paymentsReceived: 5000 }),
    ];
    const result = analyzeRevolvingBalance(statements);
    expect(result.cardIssuer).toBe('HDFC');
    expect(result.isRevolving).toBe(true);
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

  it('recommends reviewing spending for increasing balance cards', () => {
    // Create statements with clearly increasing balance trend
    const statements = Array.from({ length: 6 }, (_, i) =>
      makeStatement({
        cardIssuer: 'HDFC',
        cardLastFour: '1111',
        statementDate: new Date(`2024-${String(i + 1).padStart(2, '0')}-28`),
        totalDue: 10000 + i * 10000, // Steadily increasing
        paymentsReceived: 2500, // Paying minimum
      })
    );
    const result = calculateDebtTrapAnalysis(statements);
    expect(result.recommendations.some(r => r.includes('trending upward') || r.includes('Review spending'))).toBe(true);
  });

  it('recommends auto-pay for medium risk', () => {
    // Medium risk triggered by balanceIncreasing=true with mostly full-pay rate.
    const statements = [
      makeStatement({
        cardIssuer: 'HDFC', cardLastFour: '1111',
        statementDate: new Date('2024-01-28'),
        totalDue: 10000, paymentsReceived: 10000,
      }),
      makeStatement({
        cardIssuer: 'HDFC', cardLastFour: '1111',
        statementDate: new Date('2024-02-28'),
        totalDue: 10000, paymentsReceived: 10000,
      }),
      makeStatement({
        cardIssuer: 'HDFC', cardLastFour: '1111',
        statementDate: new Date('2024-03-28'),
        totalDue: 10000, paymentsReceived: 10000,
      }),
      makeStatement({
        cardIssuer: 'HDFC', cardLastFour: '1111',
        statementDate: new Date('2024-04-28'),
        totalDue: 20000, paymentsReceived: 5000,
      }),
    ];
    const result = calculateDebtTrapAnalysis(statements);
    expect(result.overallRiskLevel).toBe('medium');
    expect(result.recommendations.some(r => r.includes('automatic payments'))).toBe(true);
  });

  it('recommends avalanche method for multiple revolving cards', () => {
    const statements = [
      ...Array.from({ length: 6 }, (_, i) => makeStatement({
        cardIssuer: 'HDFC', cardLastFour: '1111',
        statementDate: new Date(`2024-${String(i + 1).padStart(2, '0')}-28`),
        totalDue: 25000, paymentsReceived: 2500,
      })),
      ...Array.from({ length: 6 }, (_, i) => makeStatement({
        cardIssuer: 'ICICI', cardLastFour: '2222',
        statementDate: new Date(`2024-${String(i + 1).padStart(2, '0')}-28`),
        totalDue: 25000, paymentsReceived: 2500,
      })),
    ];
    const result = calculateDebtTrapAnalysis(statements);
    expect(result.recommendations.some(r => r.includes('avalanche'))).toBe(true);
  });
});
