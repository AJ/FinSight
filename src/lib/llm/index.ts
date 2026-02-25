/**
 * Unified LLM client exports and factory functions.
 * Provides provider-aware access to Ollama and LM Studio clients.
 */

import { LLMProvider, DEFAULT_URLS } from './types';

// Re-export types
export * from './types';

// Re-export Ollama clients (for backwards compatibility)
export {
  checkOllamaRunning,
  listModels as listOllamaModels,
  generate as ollamaGenerate,
  chatStream as ollamaChatStream,
} from './ollamaClient';

export {
  checkOllamaStatus,
  listModels as listOllamaModelsBrowser,
  generate as ollamaGenerateBrowser,
  chatStream as ollamaChatStreamBrowser,
} from './ollamaBrowserClient';

// Re-export LM Studio clients
export {
  checkLMStudioRunning,
  listModels as listLMStudioModels,
  generate as lmstudioGenerate,
  chatStream as lmstudioChatStream,
} from './lmstudioClient';

export {
  checkLMStudioStatus,
  listModels as listLMStudioModelsBrowser,
  generate as lmstudioGenerateBrowser,
  chatStream as lmstudioChatStreamBrowser,
} from './lmstudioBrowserClient';

/* ── Factory functions ───────────────────────────────────── */

/**
 * Get the default URL for a given provider.
 */
export function getDefaultUrl(provider: LLMProvider): string {
  return DEFAULT_URLS[provider];
}

/**
 * Server-side client interface.
 */
export const serverClient = {
  ollama: {
    checkRunning: async (baseUrl: string) => {
      const { checkOllamaRunning } = await import('./ollamaClient');
      return checkOllamaRunning(baseUrl);
    },
    listModels: async (baseUrl: string) => {
      const { listModels } = await import('./ollamaClient');
      return listModels(baseUrl);
    },
    generate: async (baseUrl: string, model: string, prompt: string, options?: Record<string, unknown>) => {
      const { generate } = await import('./ollamaClient');
      return generate(baseUrl, model, prompt, options);
    },
    chatStream: async (baseUrl: string, model: string, messages: { role: string; content: string }[], options?: Record<string, unknown>) => {
      const { chatStream } = await import('./ollamaClient');
      return chatStream(baseUrl, model, messages, options);
    },
  },
  lmstudio: {
    checkRunning: async (baseUrl: string) => {
      const { checkLMStudioRunning } = await import('./lmstudioClient');
      return checkLMStudioRunning(baseUrl);
    },
    listModels: async (baseUrl: string) => {
      const { listModels } = await import('./lmstudioClient');
      return listModels(baseUrl);
    },
    generate: async (baseUrl: string, model: string, prompt: string, options?: Record<string, unknown>) => {
      const { generate } = await import('./lmstudioClient');
      return generate(baseUrl, model, prompt, options);
    },
    chatStream: async (baseUrl: string, model: string, messages: { role: string; content: string }[], options?: Record<string, unknown>) => {
      const { chatStream } = await import('./lmstudioClient');
      return chatStream(baseUrl, model, messages, options);
    },
  },
};

/**
 * Browser-side client interface.
 */
export const browserClient = {
  ollama: {
    checkStatus: async (baseUrl: string) => {
      const { checkOllamaStatus } = await import('./ollamaBrowserClient');
      return checkOllamaStatus(baseUrl);
    },
    listModels: async (baseUrl: string) => {
      const { listModels } = await import('./ollamaBrowserClient');
      return listModels(baseUrl);
    },
    generate: async (baseUrl: string, model: string, prompt: string, options?: Record<string, unknown>) => {
      const { generate } = await import('./ollamaBrowserClient');
      return generate(baseUrl, model, prompt, options);
    },
    chatStream: async (baseUrl: string, model: string, messages: { role: string; content: string }[], options?: Record<string, unknown>) => {
      const { chatStream } = await import('./ollamaBrowserClient');
      return chatStream(baseUrl, model, messages, options);
    },
  },
  lmstudio: {
    checkStatus: async (baseUrl: string) => {
      const { checkLMStudioStatus } = await import('./lmstudioBrowserClient');
      return checkLMStudioStatus(baseUrl);
    },
    listModels: async (baseUrl: string) => {
      const { listModels } = await import('./lmstudioBrowserClient');
      return listModels(baseUrl);
    },
    generate: async (baseUrl: string, model: string, prompt: string, options?: Record<string, unknown>) => {
      const { generate } = await import('./lmstudioBrowserClient');
      return generate(baseUrl, model, prompt, options);
    },
    chatStream: async (baseUrl: string, model: string, messages: { role: string; content: string }[], options?: Record<string, unknown>) => {
      const { chatStream } = await import('./lmstudioBrowserClient');
      return chatStream(baseUrl, model, messages, options);
    },
  },
};

/**
 * Get the server-side client for a given provider.
 */
export function getServerClient(provider: LLMProvider) {
  return serverClient[provider];
}

/**
 * Get the browser-side client for a given provider.
 */
export function getBrowserClient(provider: LLMProvider) {
  return browserClient[provider];
}
