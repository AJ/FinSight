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

  it('passes reason to aborted signals', () => {
    const manager = new AbortManager();
    const signal = manager.signal();
    manager.abortAll('custom reason');
    expect(signal.reason).toBe('custom reason');
  });

  it('handles signal already aborted before abortAll', async () => {
    const manager = new AbortManager();
    const s1 = manager.signal();
    const s2 = manager.signal();

    // Manually abort s1 via its own controller (not through manager)
    // This triggers the auto-cleanup which removes it from the set
    s1.addEventListener('abort', () => {
      // During abortAll, this auto-cleanup fires for s1
    });
    // Abort s1 individually - the auto-cleanup removes it from the set
    const controllers = (manager as unknown as { controllers: Set<AbortController> }).controllers;
    const c1 = Array.from(controllers)[0];
    c1!.abort('manual');

    // Wait for auto-cleanup event listener to fire
    await new Promise(resolve => setTimeout(resolve, 0));

    // Now s1 is already aborted and removed from the set
    // s2 is still in the set and not aborted
    manager.abortAll('remaining');

    expect(s1.aborted).toBe(true);
    expect(s2.aborted).toBe(true);
    expect(manager.activeCount).toBe(0);
  });
});
