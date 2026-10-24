interface MemoState<T> {
  promise: Promise<T> | null;
  at: number;
}

// Memoize zero-arg async function for ttlMs; concurrent callers share one invocation.
export function memoizeWithTtl<T>(
  fn: () => Promise<T>,
  ttlMs: number,
): () => Promise<T> {
  const state: MemoState<T> = { promise: null, at: 0 };

  return () =>
    state.promise && Date.now() - state.at < ttlMs
      ? state.promise
      : refresh(state, fn);
}

// Eviction is identity-checked: a slow rejection must not clear a newer cache entry.
function refresh<T>(state: MemoState<T>, fn: () => Promise<T>): Promise<T> {
  state.at = Date.now();
  const invocation: Promise<T> = fn().catch((err: unknown) => {
    if (state.promise === invocation) {
      state.promise = null;
    }
    throw err;
  });

  state.promise = invocation;

  return invocation;
}

interface KeyedEntry<T> {
  promise: Promise<T>;
  at: number;
}

/** Memoize a one-key async read per key for ttlMs; concurrent callers of a key share one invocation, a failed read is not kept, and expired keys are dropped as new ones arrive so the map does not grow without end. */
export function memoizeByKeyWithTtl<T>(
  fn: (key: string) => Promise<T>,
  ttlMs: number,
  now: () => number = Date.now,
): (key: string) => Promise<T> {
  const entries = new Map<string, KeyedEntry<T>>();

  return (key) => {
    const at = now();
    const kept = entries.get(key);

    if (kept && at - kept.at < ttlMs) {
      return kept.promise;
    }
    dropExpired(entries, at, ttlMs);

    return remember(entries, key, at, fn(key));
  };
}

function remember<T>(
  entries: Map<string, KeyedEntry<T>>,
  key: string,
  at: number,
  read: Promise<T>,
): Promise<T> {
  const promise = read.catch((err: unknown) => {
    if (entries.get(key)?.promise === promise) {
      entries.delete(key);
    }
    throw err;
  });

  entries.set(key, { promise, at });

  return promise;
}

function dropExpired<T>(
  entries: Map<string, KeyedEntry<T>>,
  at: number,
  ttlMs: number,
): void {
  for (const [key, entry] of entries) {
    if (at - entry.at >= ttlMs) {
      entries.delete(key);
    }
  }
}
