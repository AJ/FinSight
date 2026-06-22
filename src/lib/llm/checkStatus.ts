import { getClient } from "@/lib/llm/index";
import { useSettingsStore } from "@/lib/store/settingsStore";
import type { LLMProvider } from "@/lib/llm/types";
import type { LLMStatus } from "@/types";

export async function checkLLMStatus(
  url?: string,
  provider?: LLMProvider,
  model?: string,
): Promise<LLMStatus> {
  const settings = useSettingsStore.getState();
  const llmUrl = url || settings.llmServerUrl;
  const llmProvider = provider || settings.llmProvider;
  const llmModel = model ?? settings.llmModel;
  const client = getClient(llmProvider);
  // Pass the model so checkStatus enriches it on demand (spec §8) — model-selection
  // surfaces (e.g. the connection store) then read its context length from status.models.
  return client.checkStatus(llmUrl, llmModel ?? undefined);
}
