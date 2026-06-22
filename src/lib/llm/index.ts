import { LLMProvider, PROVIDERS } from './types';
import { createClient } from './client';
import type { LLMClient } from './types';

export * from './types';
export { createClient } from './client';

export function getDefaultUrl(provider: LLMProvider): string {
  return PROVIDERS[provider].defaultUrl;
}

const clientCache = new Map<LLMProvider, LLMClient>();

export function getClient(provider: LLMProvider): LLMClient {
  let client = clientCache.get(provider);
  if (!client) {
    client = createClient(provider);
    clientCache.set(provider, client);
  }
  return client;
}
