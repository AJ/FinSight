import { describe, it, expect } from 'vitest';

import { getClient, getDefaultUrl, DEFAULT_URLS } from '@/lib/llm/index';

describe('getDefaultUrl', () => {
  it('returns correct URL for ollama', () => {
    expect(getDefaultUrl('ollama')).toBe('http://localhost:11434');
  });

  it('returns correct URL for lmstudio', () => {
    expect(getDefaultUrl('lmstudio')).toBe('http://localhost:1234');
  });
});

describe('getClient', () => {
  it('returns ollama client with all methods', () => {
    const client = getClient('ollama');
    expect(client).toBeDefined();
    expect(typeof client.generate).toBe('function');
    expect(typeof client.chatStream).toBe('function');
    expect(typeof client.listModels).toBe('function');
    expect(typeof client.checkStatus).toBe('function');
  });

  it('returns lmstudio client with all methods', () => {
    const client = getClient('lmstudio');
    expect(client).toBeDefined();
    expect(typeof client.generate).toBe('function');
    expect(typeof client.chatStream).toBe('function');
    expect(typeof client.listModels).toBe('function');
    expect(typeof client.checkStatus).toBe('function');
  });

  it('returns same instance for same provider', () => {
    const a = getClient('ollama');
    const b = getClient('ollama');
    expect(a).toBe(b);
  });

  it('returns different instances for different providers', () => {
    const ollama = getClient('ollama');
    const lmstudio = getClient('lmstudio');
    expect(ollama).not.toBe(lmstudio);
  });
});

describe('DEFAULT_URLS', () => {
  it('has entries for both providers', () => {
    expect(DEFAULT_URLS.ollama).toBeTruthy();
    expect(DEFAULT_URLS.lmstudio).toBeTruthy();
  });
});
