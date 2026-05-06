import { describe, it, expect } from 'vitest';

import { getDefaultUrl, getServerClient, getBrowserClient, DEFAULT_URLS } from '@/lib/llm/index';

describe('getDefaultUrl', () => {
  it('returns correct URL for ollama', () => {
    expect(getDefaultUrl('ollama')).toBe('http://localhost:11434');
  });

  it('returns correct URL for lmstudio', () => {
    expect(getDefaultUrl('lmstudio')).toBe('http://localhost:1234');
  });
});

describe('getServerClient', () => {
  it('returns ollama server client', () => {
    const client = getServerClient('ollama');
    expect(client).toBeDefined();
    expect(typeof client.checkRunning).toBe('function');
    expect(typeof client.listModels).toBe('function');
    expect(typeof client.generate).toBe('function');
    expect(typeof client.chatStream).toBe('function');
  });

  it('returns lmstudio server client', () => {
    const client = getServerClient('lmstudio');
    expect(client).toBeDefined();
    expect(typeof client.generate).toBe('function');
  });
});

describe('getBrowserClient', () => {
  it('returns ollama browser client', () => {
    const client = getBrowserClient('ollama');
    expect(client).toBeDefined();
    expect(typeof client.checkStatus).toBe('function');
    expect(typeof client.listModels).toBe('function');
    expect(typeof client.generate).toBe('function');
    expect(typeof client.chatStream).toBe('function');
  });

  it('returns lmstudio browser client', () => {
    const client = getBrowserClient('lmstudio');
    expect(client).toBeDefined();
    expect(typeof client.checkStatus).toBe('function');
  });
});

describe('DEFAULT_URLS', () => {
  it('has entries for both providers', () => {
    expect(DEFAULT_URLS.ollama).toBeTruthy();
    expect(DEFAULT_URLS.lmstudio).toBeTruthy();
  });
});
