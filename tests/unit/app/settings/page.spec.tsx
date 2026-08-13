import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { LLMStatus } from '@/types';
import type { LLMRuntimeConfig } from '@/lib/llm/types';

// ─── Module mocks ───────────────────────────────────────────────────────────
//
// The real connection store hits the network via checkLLMStatus; the real probe
// fires an LLM generate call. Both are replaced with controllable stand-ins so
// the test observes wiring, not infrastructure.

const checkLLMConnectionMock: Mock<(force?: boolean) => Promise<LLMStatus>> = vi.fn();
vi.mock('@/lib/store/llmConnectionStore', () => ({
  checkLLMConnection: (force?: boolean) => checkLLMConnectionMock(force),
}));

const ensureModelCalibratedMock: Mock<
  (cfg: LLMRuntimeConfig) => Promise<void>
> = vi.fn();
vi.mock('@/lib/llm/calibrationProbe', () => ({
  ensureModelCalibrated: (cfg: LLMRuntimeConfig) => ensureModelCalibratedMock(cfg),
}));

import SettingsPage from '@/app/settings/page';
import { useSettingsStore } from '@/lib/store/settingsStore';

// ─── Helpers ────────────────────────────────────────────────────────────────

function seedSettings() {
  // llmServerUrl is empty so the mount auto-connect effect bails at URL validation,
  // letting the test drive Connect explicitly.
  useSettingsStore.setState({
    currency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
    dateFormat: 'auto',
    theme: 'light',
    llmProvider: 'ollama',
    llmServerUrl: '',
    llmModel: null,
    llmModelContextLength: null,
    calibrationByModel: {},
  });
}

function makeConnectedStatus(): LLMStatus {
  return {
    connected: true,
    models: [
      { id: 'm1', contextLength: 8192 },
      { id: 'm2', contextLength: 8192 },
    ],
    selectedModel: null,
  };
}

// A deferred void promise lets the test hold the probe in-flight so the
// isCalibrating window is observable, then release it deterministically.
function deferredTimer(ms: number) {
  let resolveFn: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    resolveFn = resolve;
  });
  const withDelay = promise.then(
    () => new Promise<void>((r) => setTimeout(r, ms)),
  );
  return { resolve: resolveFn, promise: withDelay };
}

async function connect(serverUrl = 'http://localhost:11434') {
  const urlInput = screen.getByLabelText('Server URL') as HTMLInputElement;
  fireEvent.change(urlInput, { target: { value: serverUrl } });
  fireEvent.click(screen.getByRole('button', { name: /Connect/i }));
}

// The page renders two radix Selects (provider + model), both with role
// "combobox". The model Select is scoped by its aria-labelledby pointing at the
// "Model" label — return that node specifically.
function getModelCombobox(): HTMLElement {
  const label = screen.getByText('Model');
  // The label's `for` (htmlFor) points at the SelectTrigger id.
  const triggerId = label.getAttribute('for');
  const trigger = document.getElementById(triggerId || 'model-select');
  if (!trigger) throw new Error('model Select trigger not found');
  return trigger;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('SettingsPage — proactive token-ratio calibration', () => {
  beforeEach(() => {
    localStorage.clear();
    seedSettings();
    checkLLMConnectionMock.mockReset();
    ensureModelCalibratedMock.mockReset();
    // jsdom does not implement scrollIntoView; radix Select calls it when an
    // option is highlighted/selected. Polyfill once per test.
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = vi.fn();
    }
    // jsdom also omits the Pointer Capture API, which radix Select invokes during
    // pointerDown handling. Without these no-ops, driving the Select throws an
    // uncaught `hasPointerCapture is not a function` after the test's assertions.
    if (!Element.prototype.hasPointerCapture) {
      Element.prototype.hasPointerCapture = () => false;
    }
    if (!Element.prototype.setPointerCapture) {
      Element.prototype.setPointerCapture = () => {};
    }
    if (!Element.prototype.releasePointerCapture) {
      Element.prototype.releasePointerCapture = () => {};
    }
  });

  it('fires ensureModelCalibrated for the silently auto-selected first model on Connect', async () => {
    checkLLMConnectionMock.mockResolvedValue(makeConnectedStatus());
    ensureModelCalibratedMock.mockResolvedValue(undefined);

    render(<SettingsPage />);
    await connect();

    // The auto-select populates the model Select once the connection resolves.
    await waitFor(() => {
      expect(screen.getByText('m1')).toBeTruthy();
    });

    // The common real flow: user clicks Connect, the first model is silently
    // selected, and the probe must fire for that model so the first import is
    // not surprised by a ~180s calibration cost.
    await waitFor(() => {
      expect(ensureModelCalibratedMock).toHaveBeenCalledWith({
        provider: 'ollama',
        baseUrl: 'http://localhost:11434',
        model: 'm1',
      });
    });
  });

  it('disables the model Select and shows a status line while the probe is in flight', async () => {
    checkLLMConnectionMock.mockResolvedValue(makeConnectedStatus());
    const probe = deferredTimer(0);
    ensureModelCalibratedMock.mockReturnValue(probe.promise);

    render(<SettingsPage />);
    await connect();

    // Wait for the model Select to mount (auto-select has run).
    await waitFor(() => {
      expect(screen.getByText('m1')).toBeTruthy();
    });

    // While the probe is in flight, the model combobox is disabled and the
    // inline status copy is shown. (The provider Select is also a combobox; the
    // model one is the second, identified by its label.)
    await waitFor(() => {
      expect(screen.getByText(/Optimizing for your model/i)).toBeTruthy();
    });
    const modelCombobox = getModelCombobox();
    expect(modelCombobox.getAttribute('data-disabled')).not.toBeNull();

    // Release the probe; the status line disappears and the combobox re-enables.
    probe.resolve();
    await waitFor(() => {
      expect(screen.queryByText(/Optimizing for your model/i)).toBeNull();
    });
    expect(getModelCombobox().getAttribute('data-disabled')).toBeNull();
  });

  it('fires ensureModelCalibrated again when the user explicitly picks another model', async () => {
    checkLLMConnectionMock.mockResolvedValue(makeConnectedStatus());
    ensureModelCalibratedMock.mockResolvedValue(undefined);

    render(<SettingsPage />);
    await connect();

    // Auto-select fires the probe for m1.
    await waitFor(() => {
      expect(ensureModelCalibratedMock).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'm1' }),
      );
    });

    // Explicit selection of m2 must also fire the probe — wiring only the
    // auto-select path would leave a manual dropdown change uncalibrated.
    // Radix Select is driven via pointer + keyboard events on the trigger,
    // then clicking the rendered option (portalled into document.body).
    const trigger = getModelCombobox();
    fireEvent.pointerDown(trigger, { button: 0 });
    fireEvent.keyDown(trigger, { key: 'Enter' });

    const m2Option = await screen.findByRole('option', { name: 'm2' });
    fireEvent.click(m2Option);

    await waitFor(() => {
      expect(ensureModelCalibratedMock).toHaveBeenCalledWith({
        provider: 'ollama',
        baseUrl: 'http://localhost:11434',
        model: 'm2',
      });
    });
  });
});
