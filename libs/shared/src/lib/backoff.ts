const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function backoffDelay(
  baseMs: number,
  attempts: number,
  maxMs: number,
): number {
  return Math.min(maxMs, baseMs * Math.pow(2, Math.max(0, attempts)));
}

export interface PollLoopOptions<T> {
  running: () => boolean;
  onOutcome: () => Promise<T>;
  delayFor: (outcome: T, idleTicks: number) => number;
  isIdle?: (outcome: T) => boolean;
  sleep?: (ms: number) => Promise<void>;
}

export async function runPollLoop<T>(opts: PollLoopOptions<T>): Promise<void> {
  const sleep = opts.sleep ?? defaultSleep;
  let idleStreak = 0;

  while (opts.running()) {
    const outcome = await opts.onOutcome();
    const currentIsIdle = opts.isIdle ? opts.isIdle(outcome) : false;
    const idleTicks = currentIsIdle ? idleStreak : 0;
    const delay = opts.delayFor(outcome, idleTicks);

    idleStreak = currentIsIdle ? idleStreak + 1 : 0;
    await sleep(delay);
  }
}

export async function pollUntil<T>(
  tick: () => Promise<T | null>,
  baseDelayMs: number,
  maxDelayMs: number,
  opts?: { sleep?: (ms: number) => Promise<void> },
): Promise<T> {
  const sleep = opts?.sleep ?? defaultSleep;
  let attempt = 0;
  let result = await tick();

  while (result === null) {
    await sleep(backoffDelay(baseDelayMs, attempt, maxDelayMs));
    attempt++;
    result = await tick();
  }

  return result;
}

// Retries a fallible async op on a fixed delay schedule: `delaysMs.length + 1` attempts total, rethrowing the last error on exhaustion — replaces two hand-rolled floor loops that ran one attempt short and never awaited the final delay.
export interface BackoffOptions {
  delaysMs: readonly number[];
  /** Injectable sleep for tests; defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Retry only errors this predicate accepts; omitted = retry every error. */
  retryOn?: (err: unknown) => boolean;
}

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
      lastError = err;
      await waitOrRethrow(err, attempt, opts, sleep);
    }
  }
  throw lastError;
}

/** Rethrows a non-retryable error; otherwise waits out this attempt's delay (if any is left). */
async function waitOrRethrow(
  err: unknown,
  attempt: number,
  opts: BackoffOptions,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  if (opts.retryOn && !opts.retryOn(err)) {
    throw err;
  }

  if (attempt < opts.delaysMs.length) {
    await sleep(opts.delaysMs[attempt]);
  }
}
