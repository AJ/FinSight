import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock the connection layer so the component never hits the network. The mock
// is hoisted; route through a top-level fn so each test can configure the return.
const mockCheckLLMConnection = vi.fn();
vi.mock('@/lib/store/llmConnectionStore', () => ({
  checkLLMConnection: (...args: unknown[]) => mockCheckLLMConnection(...args),
}));

import { OnboardingStep1 } from '@/components/onboarding/OnboardingStep1';
import type { LLMProvider, ModelInfo } from '@/lib/llm/types';
import type { ConnectionStatus } from '@/components/onboarding/OnboardingWizard';
import type { LLMStatus } from '@/types';

interface Step1Props {
  onComplete: (provider: LLMProvider, serverUrl: string, models: string[], modelInfos: ModelInfo[]) => void;
  initialProvider: LLMProvider | null;
  initialUrl: string;
  initialConnectionStatus: ConnectionStatus;
  initialModels: string[];
  initialError: string | null;
  onConnectionStatusChange: (status: ConnectionStatus) => void;
  onModelsChange: (models: string[]) => void;
  onErrorChange: (error: string | null) => void;
}

function makeProps(overrides: Partial<Step1Props> = {}): Step1Props {
  return {
    onComplete: vi.fn(),
    initialProvider: null,
    initialUrl: '',
    initialConnectionStatus: 'disconnected',
    initialModels: [],
    initialError: null,
    onConnectionStatusChange: vi.fn(),
    onModelsChange: vi.fn(),
    onErrorChange: vi.fn(),
    ...overrides,
  };
}

// Drive the UI through the real interaction path: pick Ollama, enter a URL,
// click Connect. Resolves once the async connection check has settled.
async function connect(status: LLMStatus) {
  mockCheckLLMConnection.mockResolvedValue(status);
  render(<OnboardingStep1 {...makeProps()} />);

  fireEvent.click(screen.getByText('Ollama'));
  fireEvent.change(screen.getByLabelText('Server URL'), {
    target: { value: 'http://localhost:11434' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
}

const continueButton = () =>
  screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;

describe('OnboardingStep1 — connection outcome handling', () => {
  beforeEach(() => {
    mockCheckLLMConnection.mockReset();
  });

  it('enables Continue when connected with models loaded', async () => {
    await connect({
      connected: true,
      models: [{ id: 'llama3' }, { id: 'phi3' }],
      selectedModel: 'llama3',
    });

    await waitFor(() => {
      expect(continueButton().disabled).toBe(false);
    });
  });

  it('shows the "no models loaded" message and disables Continue when connected with zero models', async () => {
    // Server is up (/api/tags returned 200) but the install has no models.
    await connect({ connected: true, models: [], selectedModel: null });

    const message = await screen.findByText(/Connected to Ollama, but no models are loaded/i);
    expect(message).toBeTruthy();
    expect(continueButton().disabled).toBe(true);
  });

  it('shows "Cannot reach" when the server is unreachable', async () => {
    await connect({ connected: false, models: [], selectedModel: null });

    const message = await screen.findByText(/Cannot reach Ollama/i);
    expect(message).toBeTruthy();
    expect(continueButton().disabled).toBe(true);
  });
});
