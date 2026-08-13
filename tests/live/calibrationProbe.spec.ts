import { describe, it, expect } from 'vitest';
import { runCalibrationProbe } from '@/lib/llm/calibrationProbe';
import { isLiveLLMAvailable, getLiveLLMUrl, getLiveLLMModel } from './helpers';

// Provider isn't exposed by helpers; read it from process.env. Importing helpers
// populates process.env from .env.test.live first, so this sees file-set values too.
const LIVE_LLM_PROVIDER = (process.env.LIVE_LLM_PROVIDER as 'ollama' | 'lmstudio') ?? 'ollama';

describe.skipIf(!isLiveLLMAvailable())('calibration probe (live)', () => {
  it('derives positive, finite ratios from a real model', async () => {
    const ratios = await runCalibrationProbe({
      provider: LIVE_LLM_PROVIDER,
      baseUrl: getLiveLLMUrl(),
      model: getLiveLLMModel(),
    });
    expect(ratios).not.toBeNull();
    expect(ratios!.inputCharsPerToken).toBeGreaterThan(0);
    expect(ratios!.inputCharsPerToken).toBeLessThan(50);
    expect(ratios!.outputTokensPerInputLine).toBeGreaterThan(0);
    expect(ratios!.outputTokensPerInputLine).toBeLessThan(1000);
    console.log('Live ratios:', ratios);
  }, 60_000);
});
