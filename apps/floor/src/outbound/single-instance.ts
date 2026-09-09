// Only one Floor may drain pipeline.events; enforced by Postgres SESSION-level advisory lock.

export interface SingleInstanceDeps {
  /** True when this process now holds the lock. Must NOT block. */
  tryAcquire: () => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
  log: (message: string) => void;
}

/** Block until sole Floor; waits instead of exiting (rolling update handover, no crash-loop). */
export async function awaitSoleInstance(
  deps: SingleInstanceDeps,
  opts: { intervalMs?: number } = {},
): Promise<void> {
  const intervalMs = opts.intervalMs ?? 2_000;
  let announced = false;

  while (!(await deps.tryAcquire())) {
    if (!announced) {
      announced = true;
      deps.log(
        "another Floor holds the event lock — waiting for it to exit before draining",
      );
    }

    await deps.sleep(intervalMs);
  }

  if (announced) {
    deps.log("event lock acquired — took over from the previous Floor");
  }
}

/** Arbitrary but FIXED advisory-lock key to prevent processes thinking they're alone. */
export const FLOOR_EVENT_LOCK_KEY = 8_140_311;

/** Session-level advisory lock on dedicated client; released when connection dies. */
export function guardLockConnection(
  client: { on(event: "error", handler: (err: Error) => void): unknown },
  deps: { log: (message: string) => void; exit: (code: number) => void },
): void {
  client.on("error", (err) => {
    deps.log(
      `event lock connection lost (${err.message}) — exiting so the next instance can take it`,
    );
    deps.exit(1);
  });
}

export async function awaitSoleFloor(): Promise<void> {
  const { getPool } = await import("./db.js");
  const client = await getPool().connect();

  guardLockConnection(client, {
    log: (message) => console.error(`[floor] ${message}`),
    exit: (code) => process.exit(code),
  });

  await awaitSoleInstance({
    tryAcquire: async () => {
      const { rows } = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock($1) AS locked",
        [FLOOR_EVENT_LOCK_KEY],
      );

      return rows[0].locked;
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: (message) => console.warn(`[floor] ${message}`),
  });
}
