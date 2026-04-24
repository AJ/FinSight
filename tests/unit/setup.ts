/**
 * Global Vitest setup file.
 * Provides mocks, factories, and utilities shared across all unit tests.
 */

import { vi, beforeEach } from 'vitest';

// ─── Mock sessionStorage ───────────────────────────────────────────────────

const mockSessionStorage: Record<string, string> = {};
global.sessionStorage = {
  getItem: vi.fn((key: string) => mockSessionStorage[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { mockSessionStorage[key] = value; }),
  removeItem: vi.fn((key: string) => { delete mockSessionStorage[key]; }),
  clear: vi.fn(() => { Object.keys(mockSessionStorage).forEach(k => delete mockSessionStorage[k]); }),
  key: vi.fn((index: number) => Object.keys(mockSessionStorage)[index] ?? null),
  get length() { return Object.keys(mockSessionStorage).length; },
} as Storage;

// ─── Mock localStorage ─────────────────────────────────────────────────────

const mockLocalStorage: Record<string, string> = {};
global.localStorage = {
  getItem: vi.fn((key: string) => mockLocalStorage[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { mockLocalStorage[key] = value; }),
  removeItem: vi.fn((key: string) => { delete mockLocalStorage[key]; }),
  clear: vi.fn(() => { Object.keys(mockLocalStorage).forEach(k => delete mockLocalStorage[k]); }),
  key: vi.fn((index: number) => Object.keys(mockLocalStorage)[index] ?? null),
  get length() { return Object.keys(mockLocalStorage).length; },
} as Storage;

// ─── Reset mocks between tests ─────────────────────────────────────────────

beforeEach(() => {
  Object.keys(mockSessionStorage).forEach(k => delete mockSessionStorage[k]);
  Object.keys(mockLocalStorage).forEach(k => delete mockLocalStorage[k]);
  vi.clearAllMocks();
});

// ─── Mock global window for browser APIs ───────────────────────────────────

// Suppress console output during tests (override in individual tests if needed)
// global.console.log = vi.fn();
// global.console.warn = vi.fn();
// global.console.error = vi.fn();
