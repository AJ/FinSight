/**
 * Centralized LLM connection status management.
 * 
 * Features:
 * - Single source of truth for connection status
 * - Deduplicates in-flight requests (only one check at a time)
 * - TTL-based caching (avoid excessive checks)
 * - Auto-invalidates when URL, provider, or model changes
 * - Shared across all components
 */

import { create } from 'zustand';
import { checkLLMStatus } from '@/lib/llm/checkStatus';
import { useSettingsStore } from '@/lib/store/settingsStore';
import type { LLMStatus } from '@/types';
import type { LLMProvider } from '@/lib/llm/types';

const CONNECTION_TTL = 30 * 1000; // 30 seconds

interface LLMConnectionState {
  // Current status
  status: LLMStatus | null;
  isLoading: boolean;
  lastChecked: number | null;
  error: string | null;
  
  // Track what the cache is for (for auto-invalidation)
  cachedUrl: string | null;
  cachedProvider: LLMProvider | null;
  cachedModel: string | null;
  
  // In-flight promise to deduplicate concurrent checks
  inFlightPromise: Promise<LLMStatus> | null;
  
  // Actions
  checkConnection: (force?: boolean) => Promise<LLMStatus>;
  clearStatus: () => void;
  invalidateCache: () => void;
}

export const useLLMConnectionStore = create<LLMConnectionState>((set, get) => ({
  status: null,
  isLoading: false,
  lastChecked: null,
  error: null,
  cachedUrl: null,
  cachedProvider: null,
  cachedModel: null,
  inFlightPromise: null,
  
  checkConnection: async (force = false) => {
    // Read current settings directly
    const settings = useSettingsStore.getState();
    const provider = settings.llmProvider;
    const url = settings.llmServerUrl;  // Single URL field for all providers
    const model = settings.llmModel;
    const now = Date.now();
    
    const state = get();
    
    // Auto-invalidate cache if settings changed
    const cacheInvalid = 
      state.cachedUrl !== url || 
      state.cachedProvider !== provider ||
      state.cachedModel !== model;
    
    // Return cached status if still valid (not forced, within TTL, same settings)
    if (!force && !cacheInvalid && state.status && state.lastChecked && (now - state.lastChecked) < CONNECTION_TTL) {
      return state.status;
    }
    
    // Return in-flight promise if a check is already running (deduplication)
    if (state.inFlightPromise) {
      return state.inFlightPromise;
    }
    
    // Start new check
    set({ isLoading: true, error: null });
    
    const promise = checkLLMStatus(url, provider)
      .then((status) => {
        set({
          status,
          isLoading: false,
          lastChecked: now,
          cachedUrl: url,
          cachedProvider: provider,
          cachedModel: model,
          inFlightPromise: null,
          error: status.connected ? null : 'LLM server not reachable',
        });

        // Refresh context length for the selected model
        if (status.connected && model) {
          const match = status.models.find(m => m.id === model);
          if (match?.contextLength !== undefined) {
            useSettingsStore.getState().setModelContextLength(match.contextLength);
          }
        }

        return status;
      })
      .catch((error) => {
        const errorMessage = error instanceof Error ? error.message : 'Connection failed';
        set({
          status: null,
          isLoading: false,
          lastChecked: now,
          cachedUrl: url,
          cachedProvider: provider,
          cachedModel: model,
          inFlightPromise: null,
          error: errorMessage,
        });
        throw error;
      });
    
    set({ inFlightPromise: promise });
    return promise;
  },
  
  clearStatus: () => {
    set({
      status: null,
      isLoading: false,
      lastChecked: null,
      error: null,
      cachedUrl: null,
      cachedProvider: null,
      cachedModel: null,
      inFlightPromise: null,
    });
  },
  
  invalidateCache: () => {
    // Clear cache metadata but keep current status until next check
    set({ lastChecked: null, cachedUrl: null, cachedProvider: null, cachedModel: null });
  },
}));

// Convenience hooks for common use cases

/**
 * Check connection status (uses cache + deduplication internally).
 * Automatically uses current settings from settingsStore.
 * Call this in useEffect on mount.
 * @param force - If true, bypass cache and fetch fresh
 */
export async function checkLLMConnection(force = false): Promise<LLMStatus> {
  return useLLMConnectionStore.getState().checkConnection(force);
}

/**
 * Get current cached status without checking.
 * Use for UI that just needs to display current state.
 */
export function getLLMConnectionStatus(): LLMStatus | null {
  return useLLMConnectionStore.getState().status;
}

/**
 * Subscribe to connection status changes.
 * Use in components that need real-time updates.
 */
export function subscribeToLLMConnection(
  callback: (status: LLMStatus | null, isLoading: boolean) => void
): () => void {
  return useLLMConnectionStore.subscribe((state) => {
    callback(state.status, state.isLoading);
  });
}
