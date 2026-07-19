import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Hoisted mocks. The connection layer and the remote-trust helpers are mocked
// so the test never touches the network or persisted trust state; useSettingsStore
// itself stays real (via importActual) so the component's selectors work normally.
const mockCheckLLMConnection = vi.fn();
const mockValidate = vi.fn();
const mockIsConfirmed = vi.fn();
const mockConfirm = vi.fn();

vi.mock('@/lib/store/llmConnectionStore', () => ({
  checkLLMConnection: (...a: unknown[]) => mockCheckLLMConnection(...a),
}));

vi.mock('@/lib/store/settingsStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/store/settingsStore')>();
  return {
    ...actual,
    validateLlmServerUrl: (...a: unknown[]) => mockValidate(...a),
    isRemoteUrlConfirmed: (...a: unknown[]) => mockIsConfirmed(...a),
    confirmRemoteUrl: (...a: unknown[]) => mockConfirm(...a),
  };
});

vi.mock('@/components/chat/chatCompanions', () => ({
  resolveModelSelection: () => null,
  findModelContextLength: () => undefined,
}));

import { AIConnectionBar } from '@/components/upload/AIConnectionBar';
import { useSettingsStore } from '@/lib/store/settingsStore';

const REMOTE_URL = 'http://10.0.0.5:11434';

// Drive the bar to the remote-warning state: type a remote URL and click Connect.
async function openRemoteWarning() {
  render(<AIConnectionBar />);
  fireEvent.change(screen.getByPlaceholderText(/localhost:11434/), {
    target: { value: REMOTE_URL },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
  await screen.findByText('Remote Server Warning');
}

describe('AIConnectionBar — remote URL trust', () => {
  beforeEach(() => {
    mockCheckLLMConnection.mockReset();
    mockValidate.mockReset();
    mockIsConfirmed.mockReset();
    mockConfirm.mockReset();

    // Any non-empty URL is valid + remote; nothing is confirmed yet; connect succeeds.
    mockValidate.mockImplementation((url: unknown) => ({
      valid: Boolean(url && String(url).trim()),
      isRemote: true,
    }));
    mockIsConfirmed.mockReturnValue(false);
    mockCheckLLMConnection.mockResolvedValue({
      connected: true,
      models: [{ id: 'llama3' }],
      selectedModel: 'llama3',
    });

    // Start with no URL so the mount auto-connect fails validation quietly and
    // doesn't race the test's own connect attempt.
    useSettingsStore.setState({ llmProvider: 'ollama', llmServerUrl: '', llmModel: null });
  });

  it('trust-without-checkbox proceeds once and does not persist the trust', async () => {
    await openRemoteWarning();

    fireEvent.click(screen.getByRole('button', { name: 'I Trust This Server' }));

    // The warning must close (regression guard: previously it re-showed in a loop).
    await waitFor(() => {
      expect(screen.queryByText('Remote Server Warning')).toBeNull();
    });
    // The connection actually proceeded.
    expect(mockCheckLLMConnection).toHaveBeenCalled();
    // Unticked checkbox → trust was not persisted.
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('trust-with-checkbox persists the trust for the URL', async () => {
    await openRemoteWarning();

    fireEvent.click(screen.getByLabelText(/Don't show again for this URL/i));
    fireEvent.click(screen.getByRole('button', { name: 'I Trust This Server' }));

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledWith(REMOTE_URL);
    });
  });
});
