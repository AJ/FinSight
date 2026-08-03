import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Controllable search params so each test can drive (or omit) the ?anomaly=true deep-link.
const mockGet: Mock<(key: string) => string | null> = vi.fn(() => null);
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: mockGet }),
}));

import TransactionsPage from '@/app/transactions/page';
import { useTransactionStore } from '@/lib/store/transactionStore';
import { useSettingsStore } from '@/lib/store/settingsStore';
import { makeTransaction } from '@tests/unit/factories';

function seedTransactions(list: ReturnType<typeof makeTransaction>[]) {
  useTransactionStore.setState({ transactions: list, selectedIds: [] });
}

function seedSettings() {
  useSettingsStore.setState({
    currency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
    llmProvider: 'ollama',
    llmServerUrl: '',
    llmModel: null,
  });
}

describe('TransactionsPage (component wiring)', () => {
  beforeEach(() => {
    mockGet.mockImplementation(() => null);
    localStorage.clear();
    seedSettings();
  });

  it('applies the ?anomaly=true deep-link on mount and respects the user toggling it off', () => {
    mockGet.mockImplementation((key: string) => (key === 'anomaly' ? 'true' : null));
    seedTransactions([
      makeTransaction({ id: 'a1', description: 'ANOMALY TX', isAnomaly: true }),
      makeTransaction({ id: 'n1', description: 'NORMAL TX' }),
    ]);

    render(<TransactionsPage />);

    // Deep-link applied via useState init: only the anomaly row is visible.
    expect(screen.getByText('ANOMALY TX')).toBeTruthy();
    expect(screen.queryByText('NORMAL TX')).toBeNull();

    // The URL-sync effect used to snap the filter back on whenever the URL still carried
    // anomaly=true and anomalies existed. After the fix the toggle holds.
    fireEvent.click(screen.getByRole('button', { name: /Anomalies/ }));
    expect(screen.getByText('ANOMALY TX')).toBeTruthy();
    expect(screen.getByText('NORMAL TX')).toBeTruthy();
  });

  it('starts with the anomaly filter off when the param is absent', () => {
    // Negative of the deep-link: no ?anomaly=true ⇒ both rows visible from the start.
    seedTransactions([
      makeTransaction({ id: 'a1', description: 'ANOMALY TX', isAnomaly: true }),
      makeTransaction({ id: 'n1', description: 'NORMAL TX' }),
    ]);

    render(<TransactionsPage />);

    expect(screen.getByText('ANOMALY TX')).toBeTruthy();
    expect(screen.getByText('NORMAL TX')).toBeTruthy();
  });

  it('auto-clears the anomaly filter when no active anomalies remain', () => {
    // Deep-link sets the filter on, but with zero anomalies the auto-clear effect turns it
    // back off so the normal row is not hidden behind an unsatisfiable filter.
    mockGet.mockImplementation((key: string) => (key === 'anomaly' ? 'true' : null));
    seedTransactions([makeTransaction({ id: 'n1', description: 'NORMAL TX' })]);

    render(<TransactionsPage />);

    expect(screen.getByText('NORMAL TX')).toBeTruthy();
  });

  it('renders the anomaly filter button only when there is an active anomaly', () => {
    seedTransactions([makeTransaction({ id: 'n1', description: 'NORMAL TX' })]);

    render(<TransactionsPage />);

    expect(screen.queryByRole('button', { name: /Anomalies/ })).toBeNull();
  });

  it('shows the empty-state copy and footer for zero transactions', () => {
    seedTransactions([]);

    render(<TransactionsPage />);

    expect(screen.getByText('No transactions yet')).toBeTruthy();
    expect(screen.getByText(/Showing 0 of 0/)).toBeTruthy();
  });
});
