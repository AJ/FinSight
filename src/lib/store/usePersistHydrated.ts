'use client';

import { useSyncExternalStore } from 'react';

type PersistApi<TState> = {
  hasHydrated: () => boolean;
  onHydrate: (listener: (state: TState) => void) => () => void;
  onFinishHydration: (listener: (state: TState) => void) => () => void;
};

type StoreWithPersist<TState> = {
  persist: PersistApi<TState>;
};

export function usePersistHydrated<TState>(
  store: StoreWithPersist<TState>
): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const unsubscribeHydrate = store.persist.onHydrate(() => onStoreChange());
      const unsubscribeFinish = store.persist.onFinishHydration(() => onStoreChange());

      return () => {
        unsubscribeHydrate();
        unsubscribeFinish();
      };
    },
    () => store.persist.hasHydrated(),
    () => false
  );
}
