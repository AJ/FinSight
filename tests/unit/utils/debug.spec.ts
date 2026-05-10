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

  it('debugWarn outputs in development mode', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.resetModules();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await import('@/lib/utils/debug');
    mod.debugWarn('stage', 'warning message');
    expect(console.warn).toHaveBeenCalledWith('[stage]', 'warning message');
  });

  it('debugWarn suppressed in production without DEBUG_LOGGING', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    delete process.env.DEBUG_LOGGING;
    vi.resetModules();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await import('@/lib/utils/debug');
    mod.debugWarn('stage', 'warning message');
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('debugSensitive outputs only with DEBUG_LOGGING=true', async () => {
    vi.stubEnv('DEBUG_LOGGING', 'true');
    vi.resetModules();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const mod = await import('@/lib/utils/debug');
    mod.debugSensitive('prompt', 'sensitive data');
    expect(console.log).toHaveBeenCalledWith('[prompt]', 'sensitive data');
  });

  it('debugSensitive suppressed without DEBUG_LOGGING', async () => {
    delete process.env.DEBUG_LOGGING;
    vi.resetModules();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const mod = await import('@/lib/utils/debug');
    mod.debugSensitive('prompt', 'sensitive data');
    expect(console.log).not.toHaveBeenCalled();
  });

  it('debugLog formats with [stage] prefix', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.resetModules();
    const mod = await import('@/lib/utils/debug');
    mod.debugLog('pipeline', 'step completed', { count: 5 });
    expect(console.log).toHaveBeenCalledWith('[pipeline]', 'step completed', { count: 5 });
  });

  it('debugLog passes non-string first arg through without prefix', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.resetModules();
    const mod = await import('@/lib/utils/debug');
    const err = new Error('raw error');
    mod.debugLog(err, 'context');
    expect(console.log).toHaveBeenCalledWith(err, 'context');
  });

  it('debugError formats with [stage] prefix', async () => {
    const mod = await import('@/lib/utils/debug');
    mod.debugError('parser', 'parse failed', { row: 10 });
    expect(console.error).toHaveBeenCalledWith('[parser]', 'parse failed', { row: 10 });
  });

  it('debugError passes non-string first arg through without prefix', async () => {
    const mod = await import('@/lib/utils/debug');
    const err = new Error('raw error');
    mod.debugError(err);
    expect(console.error).toHaveBeenCalledWith(err);
  });

  it('debugWarn passes non-string first arg through without prefix', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.resetModules();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await import('@/lib/utils/debug');
    const err = new Error('raw warning');
    mod.debugWarn(err, 'extra');
    expect(console.warn).toHaveBeenCalledWith(err, 'extra');
  });
});
