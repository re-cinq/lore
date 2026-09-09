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
