import type { LLMProvider } from './types';
import { getClient } from './index';
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
