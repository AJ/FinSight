import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Currency, Settings } from "@/types";
import { LLMProvider, DEFAULT_URLS } from "@/lib/llm/types";

/* ============================================================
   SSRF Prevention: URL Validation
   Blocks private/internal IP ranges and cloud metadata endpoints
   ============================================================ */

// Private IP ranges (RFC 1918 + link-local + cloud metadata)
const PRIVATE_IP_PATTERNS = [
  /^10\./,                          // 10.0.0.0/8
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
  /^192\.168\./,                    // 192.168.0.0/16
  /^169\.254\./,                    // 169.254.0.0/16 (link-local / cloud metadata)
  /^127\./,                         // 127.0.0.0/8 (loopback - but we allow localhost)
  /^0\.0\.0\.0/,                    // 0.0.0.0/8
  /^224\./,                         // Multicast
  /^240\./,                         // Reserved
];

const BLOCKED_HOSTS = [
  'metadata.google.internal',
  'metadata',
  'localhost.localdomain',
];

function isPrivateIP(ip: string): boolean {
  return PRIVATE_IP_PATTERNS.some(pattern => pattern.test(ip));
}

export interface URLValidationResult {
  valid: boolean;
  sanitized: string;
  error?: string;
}

export function validateOllamaUrl(inputUrl: string): URLValidationResult {
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
      return { valid: false, sanitized: '', error: 'Only HTTP and HTTPS protocols are allowed' };
    }

    const hostname = parsed.hostname.toLowerCase();

    // Block known dangerous hosts
    if (BLOCKED_HOSTS.some(blocked => hostname === blocked || hostname.endsWith('.' + blocked))) {
      return { valid: false, sanitized: '', error: 'This host is not allowed' };
    }

    // Allow localhost variants for local development
    if (hostname === 'localhost' || hostname === '[::1]' || hostname === '0.0.0.0') {
      return { valid: true, sanitized: url };
    }

    // Check for private IP ranges
    if (isPrivateIP(hostname)) {
      return { valid: false, sanitized: '', error: 'Private IP addresses are not allowed' };
    }

    return { valid: true, sanitized: url };
  } catch {
    return { valid: false, sanitized: '', error: 'Invalid URL format' };
  }
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
      currency: { code: "USD", symbol: "$", name: "US Dollar" },
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
        const result = validateOllamaUrl(url);
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
