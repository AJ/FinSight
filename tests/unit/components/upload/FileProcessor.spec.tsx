import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReviewSessionPayload } from '@/lib/pipelines/types';

// ── Boundaries mocked so the test never touches the filesystem, crypto, the
//    network, or router. isPasswordError is left REAL so the test exercises the
//    actual error classification rather than a stub of it.
const mockPipeline = vi.fn();
const mockComputeFileHash = vi.fn();
const mockRouterPush = vi.fn();

vi.mock('@/lib/pipelines/preReviewPipeline', () => ({
  runPreReviewPipeline: (...a: unknown[]) => mockPipeline(...a),
}));

vi.mock('@/lib/utils/fileHash', () => ({
  computeFileHash: (...a: unknown[]) => mockComputeFileHash(...a),
}));

vi.mock('@/lib/store/llmConnectionStore', () => ({
  subscribeToLLMConnection: () => () => {},
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush, replace: vi.fn(), refresh: vi.fn() }),
}));

// Drive the component through its real interaction surface without rendering the
// heavy child components: FileUpload exposes a button that selects a fake file;
// PasswordDialog exposes a button that submits a password when open.
const FAKE_FILE = new File(['bytes'], 'statement.pdf', { type: 'application/pdf' });

vi.mock('@/components/upload/FileUpload', () => ({
  FileUpload: ({ onFileSelect }: { onFileSelect: (f: File) => void }) => (
    <button onClick={() => onFileSelect(FAKE_FILE)}>Select File</button>
  ),
}));

vi.mock('@/components/upload/PasswordDialog', () => ({
  PasswordDialog: ({
    open,
    onSubmit,
  }: {
    open: boolean;
    onSubmit: (password: string) => void;
  }) =>
    open ? (
      <button onClick={() => onSubmit('secret')}>Submit Password</button>
    ) : null,
}));

import { FileProcessor } from '@/components/upload/FileProcessor';
import { useTransactionStore } from '@/lib/store/transactionStore';
import { useSettingsStore } from '@/lib/store/settingsStore';

// A payload the success path accepts: at least one transaction so
// processReviewSession doesn't throw "No transactions found".
const SUCCESS_PAYLOAD = {
  transactions: [{}],
  currency: { code: 'USD', symbol: '$', name: 'US Dollar' },
  format: 'pdf',
  statementType: null,
  fileName: 'statement.pdf',
  parseDate: new Date(0),
  warnings: [],
} as unknown as ReviewSessionPayload;

// An error the REAL isPasswordError classifies as a password error
// (it checks err.name === 'PasswordException'). Throwing this makes the first
// parse attempt behave like an encrypted PDF that needs a password.
function passwordError() {
  return Object.assign(new Error('PDF needs a password'), {
    name: 'PasswordException',
  });
}

describe('FileProcessor — password-retry forwards the file hash', () => {
  beforeEach(() => {
    mockPipeline.mockReset();
    mockComputeFileHash.mockReset();
    mockRouterPush.mockReset();

    mockComputeFileHash.mockResolvedValue('HASH-ABC');

    // First parse attempt (no password) needs a password; the retry with the
    // password succeeds.
    mockPipeline.mockRejectedValueOnce(passwordError());
    mockPipeline.mockResolvedValueOnce(SUCCESS_PAYLOAD);

    // Clean stores: no prior imports, so hasFileImported returns false and we
    // take the normal upload path (not the duplicate dialog).
    useTransactionStore.setState({ transactions: [] });
    useSettingsStore.setState({
      llmProvider: 'ollama',
      llmServerUrl: 'http://localhost:11434',
      llmModel: 'llama3',
      currency: { code: 'USD', symbol: '$', name: 'US Dollar' },
    });
  });

  it('passes sourceFileHash on the password-retry pipeline call', async () => {
    render(<FileProcessor />);

    // 1. Select the file -> hash computed, stored, statement-type dialog opens.
    fireEvent.click(screen.getByText('Select File'));

    // 2. Continue past the statement-type dialog (PDF defaults to auto-detect).
    const continueBtn = await screen.findByRole('button', { name: 'Continue' });
    fireEvent.click(continueBtn);

    // 3. The first parse threw a password error -> password dialog is open.
    const submitBtn = await screen.findByText('Submit Password');
    fireEvent.click(submitBtn);

    // 4. The retry must have called the pipeline, and with the hash forwarded.
    await waitFor(() => {
      expect(mockPipeline).toHaveBeenCalledTimes(2);
    });

    const retryCall = mockPipeline.mock.calls[1][0] as { sourceFileHash?: string };
    expect(retryCall.sourceFileHash).toBe('HASH-ABC');
  });
});
