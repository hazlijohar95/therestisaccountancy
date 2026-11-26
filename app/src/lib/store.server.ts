import { openStore, type Store } from '../../../src/server/instance.ts';

/** Runs fn against the club's store and releases it after. One store per call keeps every RPC stub short-lived. */
export async function withStore<T>(fn: (store: Store) => Promise<T>): Promise<T> {
  const store = await openStore();
  try {
    return await fn(store);
  } finally {
    store[Symbol.dispose]();
  }
}
