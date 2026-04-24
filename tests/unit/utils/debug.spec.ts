import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('debug', () => {
  let debugLog: typeof import('@/lib/utils/debug').debugLog;
  let debugError: typeof import('@/lib/utils/debug').debugError;

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- globalThis extension for test
    delete (globalThis as any).__DEBUG_LOGGING__;
  });

  it('debugLog outputs in development mode', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.resetModules();
    const mod = await import('@/lib/utils/debug');
    debugLog = mod.debugLog;
    debugLog('test', 'message');
    expect(console.log).toHaveBeenCalled();
  });

  it('debugLog suppressed in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    delete process.env.DEBUG_LOGGING;
    vi.resetModules();
    const mod = await import('@/lib/utils/debug');
    debugLog = mod.debugLog;
    debugLog('test', 'message');
    expect(console.log).not.toHaveBeenCalled();
  });

  it('debugLog forced with DEBUG_LOGGING', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DEBUG_LOGGING', 'true');
    vi.resetModules();
    const mod = await import('@/lib/utils/debug');
    debugLog = mod.debugLog;
    debugLog('test', 'message');
    expect(console.log).toHaveBeenCalled();
  });

  it('debugError outputs in all modes', async () => {
    const mod = await import('@/lib/utils/debug');
    debugError = mod.debugError;
    debugError('test', 'error message');
    expect(console.error).toHaveBeenCalled();
  });
});
