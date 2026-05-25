import { describe, it, expect } from 'vitest';
import { calculateAvalanche, calculateSnowball, compareStrategies } from '@/lib/creditCard/paymentStrategy';

function makeCard(overrides: { issuer: string; lastFour: string; balance: number; apr: number }) {
  return {
    issuer: overrides.issuer,
    lastFour: overrides.lastFour,
    balance: overrides.balance,
    apr: overrides.apr,
  };
}

describe('calculateAvalanche', () => {
  it('prioritizes highest APR card', () => {
    const cards = [
      makeCard({ issuer: 'A', lastFour: '1111', balance: 10000, apr: 0.30 }),
      makeCard({ issuer: 'B', lastFour: '2222', balance: 10000, apr: 0.50 }),
    ];
    const result = calculateAvalanche(cards, 5000);
    expect(result.cardPayments[0].cardIssuer).toBe('B'); // Highest APR first
  });

  it('allocates minimum payments first', () => {
    const cards = [
      makeCard({ issuer: 'A', lastFour: '1111', balance: 5000, apr: 0.40 }),
      makeCard({ issuer: 'B', lastFour: '2222', balance: 5000, apr: 0.30 }),
    ];
    const result = calculateAvalanche(cards, 10000);
    expect(result.cardPayments).toHaveLength(2);
    expect(result.cardPayments.every(cp => cp.recommendedPayment > 0)).toBe(true);
  });

  it('reserves minimum payments for all cards', () => {
    const cards = [
      makeCard({ issuer: 'A', lastFour: '1111', balance: 10000, apr: 0.40 }),
      makeCard({ issuer: 'B', lastFour: '2222', balance: 10000, apr: 0.30 }),
    ];
    const result = calculateAvalanche(cards, 1000);
    // Both cards should get some payment (at least minimum)
    expect(result.cardPayments[0].recommendedPayment).toBeGreaterThan(0);
  });

  it('handles insufficient funds where remaining < minPay', () => {
    // Two cards with large balances but very small available amount.
    // First card's 5% minimum = 500, which exceeds the available 300.
    const cards = [
      makeCard({ issuer: 'A', lastFour: '1111', balance: 10000, apr: 0.40 }),
      makeCard({ issuer: 'B', lastFour: '2222', balance: 10000, apr: 0.30 }),
    ];
    const result = calculateAvalanche(cards, 300);
    // First card gets min(500, 300) = 300; second card gets min(500, 0) = 0
    expect(result.cardPayments[0].recommendedPayment).toBe(300);
    expect(result.cardPayments[1].recommendedPayment).toBe(0);
    expect(result.totalDebt).toBe(20000);
  });
});

describe('calculateSnowball', () => {
  it('prioritizes lowest balance card', () => {
    const cards = [
      makeCard({ issuer: 'A', lastFour: '1111', balance: 20000, apr: 0.30 }),
      makeCard({ issuer: 'B', lastFour: '2222', balance: 5000, apr: 0.50 }),
    ];
    const result = calculateSnowball(cards, 5000);
    expect(result.cardPayments[0].cardIssuer).toBe('B'); // Lowest balance first
  });
});

describe('compareStrategies', () => {
  it('returns both strategies', () => {
    const cards = [
      makeCard({ issuer: 'A', lastFour: '1111', balance: 10000, apr: 0.40 }),
      makeCard({ issuer: 'B', lastFour: '2222', balance: 5000, apr: 0.30 }),
    ];
    const comparison = compareStrategies(cards, 10000);
    expect(comparison.avalanche.strategy).toBe('avalanche');
    expect(comparison.snowball.strategy).toBe('snowball');
    expect(['avalanche', 'snowball']).toContain(comparison.recommended);
  });

  it('avalanche prioritizes highest APR first', () => {
    const cards = [
      makeCard({ issuer: 'A', lastFour: '1111', balance: 10000, apr: 0.50 }),
      makeCard({ issuer: 'B', lastFour: '2222', balance: 10000, apr: 0.20 }),
    ];
    const comparison = compareStrategies(cards, 5000);
    expect(comparison.avalanche.cardPayments[0].cardIssuer).toBe('A'); // Highest APR
    expect(comparison.snowball.cardPayments[0].cardIssuer).toBe('A'); // Same balance, so same order
  });
});
