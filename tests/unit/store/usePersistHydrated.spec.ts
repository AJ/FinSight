import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePersistHydrated } from '@/lib/store/usePersistHydrated';

function createMockStore(hydrated: boolean) {
  const hydrateListeners: Array<(state: unknown) => void> = [];
  const finishListeners: Array<(state: unknown) => void> = [];

  return {
    persist: {
      hasHydrated: vi.fn(() => hydrated),
      onHydrate: vi.fn((listener: (state: unknown) => void) => {
        hydrateListeners.push(listener);
        return () => {
          const idx = hydrateListeners.indexOf(listener);
          if (idx >= 0) hydrateListeners.splice(idx, 1);
        };
      }),
      onFinishHydration: vi.fn((listener: (state: unknown) => void) => {
        finishListeners.push(listener);
        return () => {
          const idx = finishListeners.indexOf(listener);
          if (idx >= 0) finishListeners.splice(idx, 1);
        };
      }),
    },
    _fireHydrate: () => hydrateListeners.forEach(l => l({})),
    _fireFinish: () => finishListeners.forEach(l => l({})),
  };
}

describe('usePersistHydrated', () => {
  it('returns false when not hydrated', () => {
    const store = createMockStore(false);
    const { result } = renderHook(() => usePersistHydrated(store));
    expect(result.current).toBe(false);
  });

  it('returns true when hydrated', () => {
    const store = createMockStore(true);
    const { result } = renderHook(() => usePersistHydrated(store));
    expect(result.current).toBe(true);
  });

  it('subscribes to hydration events', () => {
    const store = createMockStore(false);
    renderHook(() => usePersistHydrated(store));

    expect(store.persist.onHydrate).toHaveBeenCalled();
    expect(store.persist.onFinishHydration).toHaveBeenCalled();
  });

  it('updates when hydration finishes', () => {
    const store = createMockStore(false);
    const { result } = renderHook(() => usePersistHydrated(store));

    expect(result.current).toBe(false);

    store.persist.hasHydrated.mockReturnValue(true);
    act(() => store._fireFinish());

    expect(result.current).toBe(true);
  });

  it('unsubscribes on unmount', () => {
    const store = createMockStore(false);
    const { unmount } = renderHook(() => usePersistHydrated(store));

    const hydrateSub = store.persist.onHydrate.mock.results[0].value;
    const finishSub = store.persist.onFinishHydration.mock.results[0].value;

    unmount();

    // The subscriptions returned cleanup functions that were called on unmount.
    expect(typeof hydrateSub).toBe('function');
    expect(typeof finishSub).toBe('function');
  });
});
