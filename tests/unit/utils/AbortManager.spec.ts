import { describe, it, expect } from 'vitest';
import { AbortManager } from '@/lib/utils/AbortManager';

describe('AbortManager', () => {
  it('creates abort signal', () => {
    const manager = new AbortManager();
    const signal = manager.signal();
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
    expect(manager.activeCount).toBe(1);
  });

  it('aborts all signals', () => {
    const manager = new AbortManager();
    const s1 = manager.signal();
    const s2 = manager.signal();
    manager.abortAll('test reason');
    expect(s1.aborted).toBe(true);
    expect(s2.aborted).toBe(true);
    expect(manager.activeCount).toBe(0);
  });

  it('tracks active count', () => {
    const manager = new AbortManager();
    manager.signal();
    manager.signal();
    expect(manager.activeCount).toBe(2);
  });

  it('auto-removes on abort via abortAll', async () => {
    const manager = new AbortManager();
    const s1 = manager.signal();
    manager.signal();
    expect(manager.activeCount).toBe(2);
    manager.abortAll('cleanup');
    // After abortAll, all controllers are removed
    expect(manager.activeCount).toBe(0);
    expect(s1.aborted).toBe(true);
  });

  it('handles empty abortAll', () => {
    const manager = new AbortManager();
    expect(() => manager.abortAll()).not.toThrow();
  });
});
