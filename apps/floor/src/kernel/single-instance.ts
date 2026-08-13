// Only one Floor may drain `pipeline.events`.
//
// The event loop claims rows with FOR UPDATE SKIP LOCKED, so two Floors do not
// corrupt a single row — they split the stream. That is worse than a crash and much
// harder to see: each instance handles some events with whatever code IT loaded, so a
// stale process silently processes a resume with last week's rules while the log of
// the instance you are watching stays clean. It cost this project hours twice and
// failed one assembly line with a divergence error minutes after the new rule was
// confirmed present in the loaded artifact.
//
// The port guard on :8080 does not cover this: a second Floor that never binds a
// health server, or binds a different port, drains events perfectly happily.
//
// The lock is a Postgres SESSION-level advisory lock, so it is released by the server
// the moment the holder's connection dies — no heartbeat, no reaper, and a killed
// Floor never leaves the next one locked out.

export interface SingleInstanceDeps {
  /** True when this process now holds the lock. Must NOT block. */
  tryAcquire: () => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
  log: (message: string) => void;
}

/**
 * Block until this process is the only Floor draining events.
 *
 * Waits rather than exits: during a rolling update the outgoing pod still holds the
 * lock for a few seconds, and exiting would crash-loop the new pod against its own
 * predecessor. Waiting makes the handover a pause instead of a restart storm.
 *
 * The "waiting" line is logged ONCE. It is the message that explains an otherwise
 * silent startup, so it has to be findable — and repeating it every tick would bury
 * a slow handover in noise.
 */
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

/** The advisory-lock key for "the Floor draining pipeline.events". An arbitrary but
 *  FIXED number — any two processes using a different one would both think they were
 *  alone, which is the failure this exists to prevent. */
export const FLOOR_EVENT_LOCK_KEY = 8_140_311;

/**
 * The production wait: a Postgres session-level advisory lock on a DEDICATED client.
 *
 * The client is never released back to the pool — the lock lives exactly as long as
 * its connection, which is what makes a killed Floor release it with no cleanup. A
 * pooled client would hand the lock to whichever job borrowed it next.
 */
export async function awaitSoleFloor(): Promise<void> {
  const { getPool } = await import("./db.js");
  const client = await getPool().connect();

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
