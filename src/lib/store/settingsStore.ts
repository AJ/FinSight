import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Currency, Settings } from "@/types";
import { LLMProvider, DEFAULT_URLS } from "@/lib/llm/types";

/* ============================================================
   URL Validation for LLM Server Connections (Ollama, LM Studio)
   
   Note: These tools may not support authentication.
   This validation warns users when connecting to remote hosts
   to prevent accidental connections to the wrong server.
   ============================================================ */

export interface URLValidationResult {
  valid: boolean;
  sanitized: string;
  error?: string;
  warning?: string;
  isRemote: boolean;
}

export function validateLlmServerUrl(inputUrl: string): URLValidationResult {
  try {
    // Normalize: ensure protocol, remove trailing slash
    let url = inputUrl.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'http://' + url;
    }
    url = url.replace(/\/+$/, '');

    const parsed = new URL(url);

    // Only allow http/https
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { 
        valid: false, 
        sanitized: '', 
        error: 'Only HTTP and HTTPS protocols are allowed',
        isRemote: false,
      };
    }

    const hostname = parsed.hostname.toLowerCase();

    // Check if this is a local/loopback connection
    const isLocal = 
      hostname === 'localhost' || 
      hostname === '[::1]' || 
      hostname.startsWith('127.') ||
      hostname === '0.0.0.0';

    // Warn for non-localhost connections
    let warning: string | undefined;
    if (!isLocal) {
      warning = 
        `Connecting to remote host (${hostname}). ` +
        `Ensure you trust this server - your financial data will be sent to it. ` +
        `If your LLM server requires authentication, configure it in the server settings.`;
    }

    return { 
      valid: true, 
      sanitized: url,
      warning,
      isRemote: !isLocal,
    };
  } catch {
    return { 
      valid: false, 
      sanitized: '', 
      error: 'Invalid URL format',
      isRemote: false,
    };
  }
}

/**
 * Get confirmed remote URLs from localStorage
 * These are URLs the user has explicitly confirmed they trust
 */
export function getConfirmedRemoteUrls(): Set<string> {
  try {
    const stored = localStorage.getItem('confirmedRemoteLlmUrls');
    if (!stored) return new Set();
    const urls = JSON.parse(stored) as string[];
    return new Set(urls);
  } catch {
    return new Set();
  }
}

/**
 * Add a URL to the confirmed remote URLs list
 */
export function confirmRemoteUrl(url: string): void {
  try {
    const confirmed = getConfirmedRemoteUrls();
    confirmed.add(url);
    localStorage.setItem('confirmedRemoteLlmUrls', JSON.stringify([...confirmed]));
  } catch {
    // localStorage might be unavailable or full
    console.warn('[SettingsStore] Could not save confirmed remote URL');
  }
}

/**
 * Check if a URL has been confirmed by the user
 */
export function isRemoteUrlConfirmed(url: string): boolean {
  const confirmed = getConfirmedRemoteUrls();
  return confirmed.has(url);
}

const availableCurrencies: Currency[] = [
  { code: "USD", symbol: "$", name: "US Dollar" },
  { code: "EUR", symbol: "€", name: "Euro" },
  { code: "GBP", symbol: "£", name: "British Pound" },
  { code: "INR", symbol: "₹", name: "Indian Rupee" },
  { code: "JPY", symbol: "¥", name: "Japanese Yen" },
  { code: "CNY", symbol: "¥", name: "Chinese Yuan" },
  { code: "AUD", symbol: "A$", name: "Australian Dollar" },
  { code: "CAD", symbol: "C$", name: "Canadian Dollar" },
  { code: "CHF", symbol: "Fr", name: "Swiss Franc" },
  { code: "SEK", symbol: "kr", name: "Swedish Krona" },
  { code: "SGD", symbol: "S$", name: "Singapore Dollar" },
  { code: "HKD", symbol: "HK$", name: "Hong Kong Dollar" },
  { code: "NZD", symbol: "NZ$", name: "New Zealand Dollar" },
  { code: "ZAR", symbol: "R", name: "South African Rand" },
  { code: "BRL", symbol: "R$", name: "Brazilian Real" },
  { code: "MXN", symbol: "MX$", name: "Mexican Peso" },
  { code: "MYR", symbol: "RM", name: "Malaysian Ringgit" },
  { code: "THB", symbol: "฿", name: "Thai Baht" },
  { code: "IDR", symbol: "Rp", name: "Indonesian Rupiah" },
  { code: "PHP", symbol: "₱", name: "Philippine Peso" },
  { code: "KRW", symbol: "₩", name: "South Korean Won" },
  { code: "TRY", symbol: "₺", name: "Turkish Lira" },
  { code: "RUB", symbol: "₽", name: "Russian Ruble" },
  { code: "PLN", symbol: "zł", name: "Polish Zloty" },
  { code: "AED", symbol: "د.إ", name: "UAE Dirham" },
  { code: "SAR", symbol: "﷼", name: "Saudi Riyal" },
  { code: "NGN", symbol: "₦", name: "Nigerian Naira" },
  { code: "EGP", symbol: "E£", name: "Egyptian Pound" },
  { code: "PKR", symbol: "₨", name: "Pakistani Rupee" },
  { code: "BDT", symbol: "৳", name: "Bangladeshi Taka" },
];

interface SettingsStore extends Settings {
  // LLM settings
  llmProvider: LLMProvider;
  ollamaUrl: string; // Kept for backwards compatibility
  llmModel: string | null;

  setCurrency: (currency: Currency) => void;
  setDateFormat: (format: string) => void;
  setTheme: (theme: "light" | "dark") => void;
  getAvailableCurrencies: () => Currency[];
  setLLMProvider: (provider: LLMProvider) => void;
  setOllamaUrl: (url: string) => void;
  setLLMModel: (model: string | null) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      currency: { code: "INR", symbol: "₹", name: "Indian Rupee" },
      dateFormat: "auto",
      theme: "light",

      // LLM defaults
      llmProvider: "ollama",
      ollamaUrl: "http://localhost:11434",
      llmModel: null,

      setCurrency: (currency) => set({ currency }),
      setDateFormat: (format) => set({ dateFormat: format }),
      setTheme: (theme) => set({ theme }),
      getAvailableCurrencies: () => availableCurrencies,
      setLLMProvider: (provider) => set({
        llmProvider: provider,
        ollamaUrl: DEFAULT_URLS[provider], // Reset URL to provider default
        llmModel: null, // Clear model selection when switching providers
      }),
      setOllamaUrl: (url) => {
        const result = validateLlmServerUrl(url);
        if (result.valid) {
          set({ ollamaUrl: result.sanitized });
        } else {
          // Still set the URL but it will fail on connection test
          // This allows users to see what they typed
          set({ ollamaUrl: url });
        }
      },
      setLLMModel: (model) => set({ llmModel: model }),
    }),
    {
      name: "settings-storage",
      migrate: (persisted) => {
        // Migration from v0 (no llmProvider) to v1 (with llmProvider)
        const state = persisted as Record<string, unknown>;
        if (!state.llmProvider) {
          state.llmProvider = "ollama";
        }
        return state as unknown as SettingsStore;
      },
      version: 1,
    },
  ),
);

