/**
 * Retry a fallible async operation with a fixed schedule of backoff delays.
 * Runs `delaysMs.length + 1` attempts total: the initial try, then one more after
 * each delay. `delaysMs[i]` is awaited between attempt `i` and attempt `i + 1`, so
 * `[1000, 4000]` means 3 attempts sleeping 1s then 4s. On exhaustion the last error
 * is rethrown so the caller can record the failure.
 *
 * (Replaces the two hand-rolled `for (attempt < delays.length)` loops in the floor
 * escalation + auto-merge jobs, which ran one fewer attempt than their comments
 * claimed and never awaited the final delay.)
 */
export interface BackoffOptions {
  delaysMs: readonly number[];
  /** Injectable sleep for tests; defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function withBackoff<T>(fn: () => Promise<T>, opts: BackoffOptions): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  let lastError: unknown;
  for (let attempt = 0; attempt <= opts.delaysMs.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < opts.delaysMs.length) await sleep(opts.delaysMs[attempt]);
    }
  }
  throw lastError;
}
