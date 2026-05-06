import { describe, it, expect, beforeEach, vi } from 'vitest';

import { useRecurringStore } from '@/lib/store/recurringStore';
import { type RecurringPayment } from '@/lib/recurring/types';

vi.mock('@/lib/recurring', () => ({
  detectRecurringPayments: vi.fn(),
  DEFAULT_DETECTION_CONFIG: {
    minOccurrences: 2,
    minOccurrencesYearly: 1,
    amountVariance: 0.10,
    intervalTolerance: 7,
    inactiveAfterMissed: 2,
    confidenceThreshold: 0.7,
    excludeVariableAmounts: true,
  },
}));

import { detectRecurringPayments } from '@/lib/recurring';

beforeEach(() => {
  vi.clearAllMocks();
  useRecurringStore.setState({
    recurringPayments: [],
    excludedMerchants: [],
    lastScanned: null,
    isScanning: false,
  });
});

function makeRecurringPayment(overrides: Partial<RecurringPayment> = {}): RecurringPayment {
  return {
    id: 'rp-1',
    merchantName: 'Netflix',
    originalMerchantNames: ['NETFLIX.COM'],
    category: 'entertainment',
    amount: 499,
    averageAmount: 499,
    frequency: 'monthly',
    confidence: 0.95,
    firstSeen: new Date('2024-01-01'),
    lastSeen: new Date('2024-06-01'),
    occurrenceCount: 6,
    transactionIds: ['t1', 't2', 't3'],
    isActive: true,
    nextExpectedDate: new Date('2024-07-01'),
    status: 'active',
    ...overrides,
  };
}

describe('recurringStore', () => {
  describe('scanTransactions', () => {
    it('detects recurring payments from transactions', () => {
      const payment = makeRecurringPayment();
      vi.mocked(detectRecurringPayments).mockReturnValue([payment]);

      useRecurringStore.getState().scanTransactions([]);

      const state = useRecurringStore.getState();
      expect(state.recurringPayments).toHaveLength(1);
      expect(state.recurringPayments[0].merchantName).toBe('Netflix');
      expect(state.isScanning).toBe(false);
      expect(state.lastScanned).toBeInstanceOf(Date);
    });

    it('is a no-op if already scanning', () => {
      useRecurringStore.setState({ isScanning: true });
      useRecurringStore.getState().scanTransactions([]);

      expect(detectRecurringPayments).not.toHaveBeenCalled();
      expect(useRecurringStore.getState().isScanning).toBe(true);
    });

    it('filters excluded merchants', () => {
      const netflix = makeRecurringPayment({ merchantName: 'Netflix' });
      const spotify = makeRecurringPayment({ id: 'rp-2', merchantName: 'Spotify' });
      vi.mocked(detectRecurringPayments).mockReturnValue([netflix, spotify]);

      useRecurringStore.setState({
        excludedMerchants: [{ normalizedName: 'netflix', excludedAt: new Date() }],
      });
      useRecurringStore.getState().scanTransactions([]);

      const payments = useRecurringStore.getState().recurringPayments;
      expect(payments).toHaveLength(1);
      expect(payments[0].merchantName).toBe('Spotify');
    });

    it('catches errors and resets isScanning', () => {
      vi.mocked(detectRecurringPayments).mockImplementation(() => {
        throw new Error('Scan exploded');
      });

      useRecurringStore.getState().scanTransactions([]);

      expect(useRecurringStore.getState().isScanning).toBe(false);
      expect(useRecurringStore.getState().recurringPayments).toHaveLength(0);
    });

    it('sets lastScanned timestamp', () => {
      vi.mocked(detectRecurringPayments).mockReturnValue([]);
      useRecurringStore.getState().scanTransactions([]);

      expect(useRecurringStore.getState().lastScanned).toBeInstanceOf(Date);
    });
  });

  describe('updatePayment', () => {
    it('updates matching payment', () => {
      const payment = makeRecurringPayment();
      useRecurringStore.setState({ recurringPayments: [payment] });
      useRecurringStore.getState().updatePayment('rp-1', { amount: 599 });

      expect(useRecurringStore.getState().recurringPayments[0].amount).toBe(599);
    });

    it('preserves non-updated fields', () => {
      const payment = makeRecurringPayment();
      useRecurringStore.setState({ recurringPayments: [payment] });
      useRecurringStore.getState().updatePayment('rp-1', { amount: 599 });

      const updated = useRecurringStore.getState().recurringPayments[0];
      expect(updated.merchantName).toBe('Netflix');
      expect(updated.frequency).toBe('monthly');
    });

    it('is a no-op for nonexistent id', () => {
      const payment = makeRecurringPayment();
      useRecurringStore.setState({ recurringPayments: [payment] });
      useRecurringStore.getState().updatePayment('nonexistent', { amount: 999 });

      expect(useRecurringStore.getState().recurringPayments[0].amount).toBe(499);
    });
  });

  describe('markAsNotRecurring', () => {
    it('removes payment and adds to excluded merchants', () => {
      const payment = makeRecurringPayment();
      useRecurringStore.setState({ recurringPayments: [payment] });
      useRecurringStore.getState().markAsNotRecurring('rp-1', 'Netflix');

      const state = useRecurringStore.getState();
      expect(state.recurringPayments).toHaveLength(0);
      expect(state.excludedMerchants).toHaveLength(1);
      expect(state.excludedMerchants[0].normalizedName).toBe('netflix');
    });

    it('preserves other payments when removing one', () => {
      const netflix = makeRecurringPayment({ merchantName: 'Netflix' });
      const spotify = makeRecurringPayment({ id: 'rp-2', merchantName: 'Spotify' });
      useRecurringStore.setState({ recurringPayments: [netflix, spotify] });
      useRecurringStore.getState().markAsNotRecurring('rp-1', 'Netflix');

      expect(useRecurringStore.getState().recurringPayments).toHaveLength(1);
      expect(useRecurringStore.getState().recurringPayments[0].merchantName).toBe('Spotify');
    });
  });

  describe('clearExcludedMerchants', () => {
    it('clears the excluded merchants list', () => {
      useRecurringStore.setState({
        excludedMerchants: [
          { normalizedName: 'netflix', excludedAt: new Date() },
          { normalizedName: 'spotify', excludedAt: new Date() },
        ],
      });
      useRecurringStore.getState().clearExcludedMerchants();

      expect(useRecurringStore.getState().excludedMerchants).toHaveLength(0);
    });
  });

  describe('getActivePayments', () => {
    it('returns only active payments', () => {
      const active = makeRecurringPayment({ isActive: true });
      const inactive = makeRecurringPayment({ id: 'rp-2', isActive: false });
      useRecurringStore.setState({ recurringPayments: [active, inactive] });

      const result = useRecurringStore.getState().getActivePayments();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('rp-1');
    });
  });

  describe('getInactivePayments', () => {
    it('returns only inactive payments', () => {
      const active = makeRecurringPayment({ isActive: true });
      const inactive = makeRecurringPayment({ id: 'rp-2', isActive: false });
      useRecurringStore.setState({ recurringPayments: [active, inactive] });

      const result = useRecurringStore.getState().getInactivePayments();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('rp-2');
    });
  });

  describe('getTotalMonthlyRecurring', () => {
    it('sums active monthly payments', () => {
      const p1 = makeRecurringPayment({ amount: 500, frequency: 'monthly', isActive: true });
      const p2 = makeRecurringPayment({ id: 'rp-2', amount: 200, frequency: 'monthly', isActive: true });
      useRecurringStore.setState({ recurringPayments: [p1, p2] });

      expect(useRecurringStore.getState().getTotalMonthlyRecurring()).toBe(700);
    });

    it('excludes inactive payments', () => {
      const active = makeRecurringPayment({ amount: 500, frequency: 'monthly', isActive: true });
      const inactive = makeRecurringPayment({ id: 'rp-2', amount: 1000, frequency: 'monthly', isActive: false });
      useRecurringStore.setState({ recurringPayments: [active, inactive] });

      expect(useRecurringStore.getState().getTotalMonthlyRecurring()).toBe(500);
    });

    it('converts weekly to monthly (×4.33)', () => {
      const weekly = makeRecurringPayment({ amount: 100, frequency: 'weekly', isActive: true });
      useRecurringStore.setState({ recurringPayments: [weekly] });

      const total = useRecurringStore.getState().getTotalMonthlyRecurring();
      expect(total).toBeCloseTo(433, -1); // 100 * 4.33 ≈ 433
    });

    it('converts quarterly to monthly (÷3)', () => {
      const quarterly = makeRecurringPayment({ amount: 900, frequency: 'quarterly', isActive: true });
      useRecurringStore.setState({ recurringPayments: [quarterly] });

      expect(useRecurringStore.getState().getTotalMonthlyRecurring()).toBe(300);
    });

    it('converts yearly to monthly (÷12)', () => {
      const yearly = makeRecurringPayment({ amount: 1200, frequency: 'yearly', isActive: true });
      useRecurringStore.setState({ recurringPayments: [yearly] });

      expect(useRecurringStore.getState().getTotalMonthlyRecurring()).toBe(100);
    });

    it('returns 0 for empty payments', () => {
      expect(useRecurringStore.getState().getTotalMonthlyRecurring()).toBe(0);
    });
  });
});
