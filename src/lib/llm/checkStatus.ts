import { getClient } from "@/lib/llm/index";
import { useSettingsStore } from "@/lib/store/settingsStore";
import type { LLMProvider } from "@/lib/llm/types";
import type { LLMStatus } from "@/types";

export async function checkLLMStatus(
  url?: string,
  provider?: LLMProvider,
): Promise<LLMStatus> {
  const settings = useSettingsStore.getState();
  const llmUrl = url || settings.llmServerUrl;
  const llmProvider = provider || settings.llmProvider;
  const client = getClient(llmProvider);
  return client.checkStatus(llmUrl);
}
