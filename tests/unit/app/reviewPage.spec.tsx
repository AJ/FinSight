import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock next/navigation so we can assert the redirect without a router. useRouter is a
// genuine boundary; the stores stay real (seeded below) so the page's selectors work.
const mockPush: Mock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

import ReviewPage from '@/app/review/page';
import { useSettingsStore } from '@/lib/store/settingsStore';
import { reviewSessionRepository } from '@/lib/review/reviewSessionRepository';
import { makeTransaction } from '@tests/unit/factories';
import '@/lib/categorization/categories';

const INR = { code: 'INR', symbol: '₹', name: 'Indian Rupee' };

function seedSettings() {
  useSettingsStore.setState({
    currency: INR,
    llmProvider: 'ollama',
    llmServerUrl: '',
    llmModel: null,
  });
}

describe('ReviewPage — empty session redirect', () => {
  beforeEach(() => {
    mockPush.mockReset();
    sessionStorage.clear();
    seedSettings();
  });

  it('redirects to the dashboard when there is no review session', () => {
    // sessionStorage is empty → reviewSessionRepository.load() returns null. Previously this
    // left pendingTransactions null forever and the page hung on the loading screen; now it
    // seeds [] and redirects.
    render(<ReviewPage />);

    // The redirect only fires once pendingTransactions resolves to [] — i.e. the page did
    // NOT hang on the loading state (which would leave pendingTransactions null forever).
    expect(mockPush).toHaveBeenCalledWith('/');
  });

  it('does not render the old "Loading..." text in any state', () => {
    // The loading state is now a spinner, never the literal text fallback.
    render(<ReviewPage />);
    expect(screen.queryByText('Loading...')).toBeNull();
  });

  it('does NOT redirect and renders the table when a real session exists', () => {
    // Negative of the redirect: a present session must seed the working copy and render the
    // review rows, not bail to the dashboard.
    const txn = makeTransaction({ id: 'r1', description: 'PRESENT SESSION TXN' });
    const payload = {
      transactions: [txn.toJSON()],
      currency: INR,
      format: 'pdf' as const,
      statementType: 'bank' as const,
      fileName: 'stmt.pdf',
      parseDate: new Date('2024-01-15').toISOString(),
      statementSummary: null,
      verificationReport: null,
      warnings: [] as string[],
      sourceMetadata: undefined,
    };
    sessionStorage.setItem('review-session-v1', JSON.stringify(payload));

    render(<ReviewPage />);

    expect(screen.getByText('PRESENT SESSION TXN')).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();
  });
});

// Keep the repository's load/clear contract honest: these are the primitives the page leans on.
describe('reviewSessionRepository', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('load() returns null when no session is stored', () => {
    expect(reviewSessionRepository.load()).toBeNull();
  });

  it('clear() is a no-op when nothing is stored', () => {
    expect(() => reviewSessionRepository.clear()).not.toThrow();
  });
});
