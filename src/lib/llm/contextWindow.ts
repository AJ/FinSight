import type { LLMProvider } from './types';
import { getClient } from './index';
import { SYSTEM_PROMPT } from './prompts';
import { useSettingsStore } from '@/lib/store/settingsStore';

export interface ContextWindowInfo {
  contextLength: number | undefined;
  source: 'settings_cache' | 'listModels_fallback';
  provider: LLMProvider;
  modelId: string | null;
}

export interface ContextWindowOverrides {
  provider: LLMProvider;
  baseUrl: string;
  model: string;
}

// Token budget constants for maxTokens calculation
const INPUT_BUFFER = 200;
const OUTPUT_BUFFER = 300;
const MIN_OUTPUT_TOKENS = 256;
const SYSTEM_PROMPT_TOKENS = Math.ceil(SYSTEM_PROMPT.length / 4);

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Calculate context-aware maxTokens for a generate() call.
 * Budgets: system prompt + stage prompt + input estimation buffer + output formatting buffer.
 * Returns undefined when contextWindowTokens is unknown (lets the model use its default).
 */
export function calculateMaxTokens(
  contextWindowTokens: number | undefined,
  stagePrompt: string,
): number | undefined {
  if (!contextWindowTokens) return undefined;

  const stageTokens = estimateTokens(stagePrompt);
  return Math.max(
    MIN_OUTPUT_TOKENS,
    contextWindowTokens - SYSTEM_PROMPT_TOKENS - stageTokens - INPUT_BUFFER - OUTPUT_BUFFER,
  );
}

export async function getContextWindowInfo(
  overrides?: ContextWindowOverrides,
): Promise<ContextWindowInfo> {
  const settings = useSettingsStore.getState();
  const provider = overrides?.provider ?? settings.llmProvider;
  const baseUrl = overrides?.baseUrl ?? settings.llmServerUrl;
  const modelId = overrides?.model ?? settings.llmModel;
  const cached = settings.llmModelContextLength;

  if (cached !== null && cached > 0) {
    return {
      contextLength: cached,
      source: 'settings_cache',
      provider,
      modelId,
    };
  }

  try {
    const client = getClient(provider);
    const models = await client.listModels(baseUrl);
    const match = modelId
      ? models.find((m) => m.id === modelId)
      : models[0];

    const contextLength = match?.contextLength;
    if (contextLength !== undefined && settings.setModelContextLength) {
      settings.setModelContextLength(contextLength);
    }

    return {
      contextLength,
      source: 'listModels_fallback',
      provider,
      modelId,
    };
  } catch {
    return {
      contextLength: undefined,
      source: 'listModels_fallback',
      provider,
      modelId,
    };
  }
}
