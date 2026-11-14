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

export interface StaleWindow {
  /** Within this age the kept value is answered with no read. */
  freshMs: number;
  /** Up to this age the kept value is answered at once and refreshed behind the caller; past it the caller waits. */
  staleMs: number;
}

/** A keyed read that never makes a caller wait on a value it already holds: between `freshMs` and `staleMs` the kept value is answered and ONE refresh runs in the background (a failed one keeps the old value and is logged); past `staleMs`, or with nothing kept, the caller waits as with {@link memoizeByKeyWithTtl}. */
export function memoizeByKeyStaleWhileRefreshing<T>(
  fn: (key: string) => Promise<T>,
  window: StaleWindow,
  now: () => number = Date.now,
): (key: string) => Promise<T> {
  const memo = new StaleWhileRefreshing(fn, window, now);

  return (key) => memo.read(key);
}

class StaleWhileRefreshing<T> {
  private readonly entries = new Map<string, KeyedEntry<T>>();
  private readonly refreshing = new Set<string>();

  constructor(
    private readonly fn: (key: string) => Promise<T>,
    private readonly window: StaleWindow,
    private readonly now: () => number,
  ) {}

  read(key: string): Promise<T> {
    const at = this.now();
    const kept = this.entries.get(key);

    if (kept && at - kept.at < this.window.staleMs) {
      this.refreshWhenStale(key, at - kept.at);

      return kept.promise;
    }
    dropExpired(this.entries, at, this.window.staleMs);

    return remember(this.entries, key, at, this.fn(key));
  }

  private refreshWhenStale(key: string, age: number): void {
    if (age < this.window.freshMs || this.refreshing.has(key)) {
      return;
    }
    this.refreshing.add(key);
    this.fn(key)
      .then(
        (value) =>
          this.entries.set(key, {
            promise: Promise.resolve(value),
            at: this.now(),
          }),
        (err: unknown) =>
          console.warn(
            `[ttl-memo] refresh of ${key} failed, keeping the old value: ${String(err)}`,
          ),
      )
      .finally(() => this.refreshing.delete(key));
  }
}
