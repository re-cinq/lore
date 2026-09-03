// Retries a fallible async op on a fixed delay schedule: `delaysMs.length + 1` attempts total, rethrowing the last error on exhaustion — replaces two hand-rolled floor loops that ran one attempt short and never awaited the final delay.
export interface BackoffOptions {
  delaysMs: readonly number[];
  /** Injectable sleep for tests; defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Retry only errors this predicate accepts; omitted = retry every error. */
  retryOn?: (err: unknown) => boolean;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function withBackoff<T>(
  fn: () => Promise<T>,
  opts: BackoffOptions,
): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.delaysMs.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (opts.retryOn && !opts.retryOn(err)) {
        throw err;
      }
      lastError = err;

      if (attempt < opts.delaysMs.length) {
        await sleep(opts.delaysMs[attempt]);
      }
    }
  }
  throw lastError;
}
