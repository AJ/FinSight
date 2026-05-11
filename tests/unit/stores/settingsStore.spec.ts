import { describe, it, expect, beforeEach } from 'vitest';
import {
  useSettingsStore,
  validateLlmServerUrl,
  getConfirmedRemoteUrls,
  confirmRemoteUrl,
  isRemoteUrlConfirmed,
} from '@/lib/store/settingsStore';
import { DEFAULT_URLS } from '@/lib/llm/types';

const initialState = {
  currency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
  dateFormat: 'auto',
  theme: 'light' as const,
  llmProvider: 'ollama' as const,
  llmServerUrl: DEFAULT_URLS.ollama,
  llmModel: null,
  llmModelContextLength: null,
};

describe('useSettingsStore', () => {
  beforeEach(() => {
    useSettingsStore.setState(initialState);
    localStorage.clear();
  });

  describe('setCurrency', () => {
    it('updates currency', () => {
      useSettingsStore.getState().setCurrency({ code: 'USD', symbol: '$', name: 'US Dollar' });
      expect(useSettingsStore.getState().currency.code).toBe('USD');
    });
  });

  describe('setDateFormat', () => {
    it('updates dateFormat', () => {
      useSettingsStore.getState().setDateFormat('MM/DD/YYYY');
      expect(useSettingsStore.getState().dateFormat).toBe('MM/DD/YYYY');
    });
  });

  describe('setTheme', () => {
    it('updates theme', () => {
      useSettingsStore.getState().setTheme('dark');
      expect(useSettingsStore.getState().theme).toBe('dark');
    });
  });

  describe('getAvailableCurrencies', () => {
    it('returns a non-empty currency list', () => {
      const currencies = useSettingsStore.getState().getAvailableCurrencies();
      expect(currencies.length).toBeGreaterThan(0);
      expect(currencies[0]).toHaveProperty('code');
      expect(currencies[0]).toHaveProperty('symbol');
    });
  });

  describe('setLLMProvider', () => {
    it('auto-switches URL to localhost for lmstudio', () => {
      useSettingsStore.getState().setLLMProvider('lmstudio');
      expect(useSettingsStore.getState().llmServerUrl).toBe('http://localhost:1234');
    });

    it('auto-switches URL to localhost for ollama', () => {
      useSettingsStore.getState().setLLMProvider('ollama');
      expect(useSettingsStore.getState().llmServerUrl).toBe('http://localhost:11434');
    });

    it('clears model when switching providers', () => {
      useSettingsStore.getState().setLLMModel('some-model');
      useSettingsStore.getState().setLLMProvider('lmstudio');
      expect(useSettingsStore.getState().llmModel).toBeNull();
    });

    it('clears context length when switching providers', () => {
      useSettingsStore.getState().setModelContextLength(4096);
      useSettingsStore.getState().setLLMProvider('lmstudio');
      expect(useSettingsStore.getState().llmModelContextLength).toBeNull();
    });
  });

  describe('setLLMServerUrl', () => {
    it('sets sanitized URL for valid input', () => {
      useSettingsStore.getState().setLLMServerUrl('http://192.168.1.100:11434');
      expect(useSettingsStore.getState().llmServerUrl).toBe('http://192.168.1.100:11434');
    });

    it('sets raw URL for unparseable input', () => {
      useSettingsStore.getState().setLLMServerUrl('');
      expect(useSettingsStore.getState().llmServerUrl).toBe('');
    });
  });

  describe('setLLMModel', () => {
    it('sets model name', () => {
      useSettingsStore.getState().setLLMModel('llama3');
      expect(useSettingsStore.getState().llmModel).toBe('llama3');
    });

    it('clears model with null', () => {
      useSettingsStore.getState().setLLMModel('llama3');
      useSettingsStore.getState().setLLMModel(null);
      expect(useSettingsStore.getState().llmModel).toBeNull();
    });
  });

  describe('setModelContextLength', () => {
    it('sets context length', () => {
      useSettingsStore.getState().setModelContextLength(8192);
      expect(useSettingsStore.getState().llmModelContextLength).toBe(8192);
    });

    it('clears with null', () => {
      useSettingsStore.getState().setModelContextLength(8192);
      useSettingsStore.getState().setModelContextLength(null);
      expect(useSettingsStore.getState().llmModelContextLength).toBeNull();
    });
  });
});

describe('validateLlmServerUrl', () => {
  it('validates localhost URL', () => {
    const result = validateLlmServerUrl('http://localhost:11434');
    expect(result.valid).toBe(true);
    expect(result.isRemote).toBe(false);
    expect(result.warning).toBeUndefined();
  });

  it('adds protocol when missing', () => {
    const result = validateLlmServerUrl('localhost:11434');
    expect(result.valid).toBe(true);
    expect(result.sanitized).toBe('http://localhost:11434');
  });

  it('strips trailing slashes', () => {
    const result = validateLlmServerUrl('http://localhost:11434///');
    expect(result.sanitized).toBe('http://localhost:11434');
  });

  it('flags remote URLs', () => {
    const result = validateLlmServerUrl('http://192.168.1.100:11434');
    expect(result.valid).toBe(true);
    expect(result.isRemote).toBe(true);
    expect(result.warning).toBeDefined();
  });

  it('rejects empty URL', () => {
    const result = validateLlmServerUrl('');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects non-http protocol (ftp://)', () => {
    const result = validateLlmServerUrl('ftp://example.com:21');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Only HTTP and HTTPS protocols are allowed');
    expect(result.isRemote).toBe(false);
  });

  it('rejects non-http protocol (javascript:)', () => {
    const result = validateLlmServerUrl('javascript:alert(1)');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Only HTTP and HTTPS protocols are allowed');
  });

  it('recognizes IPv6 loopback [::1] as local', () => {
    const result = validateLlmServerUrl('http://[::1]:11434');
    expect(result.valid).toBe(true);
    expect(result.isRemote).toBe(false);
    expect(result.warning).toBeUndefined();
  });

  it('recognizes hostname starting with 127. as local', () => {
    const result = validateLlmServerUrl('http://127.0.0.5:11434');
    expect(result.valid).toBe(true);
    expect(result.isRemote).toBe(false);
    expect(result.warning).toBeUndefined();
  });
});

describe('remote URL confirmation', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts with empty confirmed set', () => {
    const urls = getConfirmedRemoteUrls();
    expect(urls.size).toBe(0);
  });

  it('confirmRemoteUrl adds to confirmed set', () => {
    confirmRemoteUrl('http://192.168.1.100:11434');
    expect(isRemoteUrlConfirmed('http://192.168.1.100:11434')).toBe(true);
  });

  it('isRemoteUrlConfirmed returns false for unconfirmed URL', () => {
    expect(isRemoteUrlConfirmed('http://example.com')).toBe(false);
  });

  it('getConfirmedRemoteUrls returns empty Set for corrupted JSON in localStorage', () => {
    localStorage.setItem('confirmedRemoteLlmUrls', '{not valid json}');
    const urls = getConfirmedRemoteUrls();
    expect(urls).toBeInstanceOf(Set);
    expect(urls.size).toBe(0);
  });

  it('confirmRemoteUrl catches localStorage failure gracefully', () => {
    // Temporarily make localStorage.setItem throw
    const originalSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = () => { throw new Error('QuotaExceededError'); };

    // Should not throw
    expect(() => confirmRemoteUrl('http://example.com')).not.toThrow();

    // Restore
    localStorage.setItem = originalSetItem;
  });
});

describe('settingsStore persist migrate', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('fills missing fields from old persisted state', async () => {
    // Simulate a v0 state missing llmProvider and llmModelContextLength
    const oldState = {
      state: {
        currency: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
        dateFormat: 'auto',
        theme: 'light',
        llmServerUrl: 'http://localhost:11434',
        llmModel: null,
        // llmProvider and llmModelContextLength are missing
      },
      version: 0,
    };

    localStorage.setItem('settings-storage', JSON.stringify(oldState));

    const { useSettingsStore: freshStore } = await import('@/lib/store/settingsStore?' + Date.now());

    // Migrate should have added the missing fields with defaults
    expect(freshStore.getState().llmProvider).toBe('ollama');
    expect(freshStore.getState().llmModelContextLength).toBeNull();

    localStorage.removeItem('settings-storage');
  });
});
