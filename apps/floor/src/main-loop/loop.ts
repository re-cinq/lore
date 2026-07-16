/**
 * The drain loop (layer 2): claim a batch, dispatch each event to its registered
 * handler, transition the row. At-least-once — claim increments attempts up front,
 * so a crash-looping handler still walks to the dead-letter cutoff. Store ops are
 * injected so the dispatch logic is unit-testable without a database.
 */

import { decideRetry } from "./retry.js";
import { claimBatch, markDone, markFailed, markDead } from "./store.js";
import type { EventHandler, EventRow } from "./types.js";

export interface LoopDeps {
  resolve: (eventName: string) => EventHandler | undefined;
  claim: (limit: number, excludeEventNames: string[]) => Promise<EventRow[]>;
  markDone: (id: string) => Promise<void>;
  markFailed: (
    id: string,
    error: string,
    backoffSeconds: number,
  ) => Promise<void>;
  markDead: (id: string, error: string) => Promise<void>;
  batchSize?: number;
}

/**
 * Families whose handlers contend on shared external state (dgraph — every
 * spec-trace writer aborts its concurrent twin): at most one handler in flight
 * per Floor instance. Exclusion happens at CLAIM time so waiting rows stay
 * `pending` — a dispatch-side queue would park claimed rows in `processing`,
 * where anything waiting >600s is reaped as presumed-dead, re-claimed, and run
 * concurrently anyway (the observed duplicate-self race on long projections).
 * Cross-instance conflicts are absorbed by withTxn's retry-on-abort.
 */
const SERIAL_FAMILIES: ReadonlySet<string> = new Set([
  "internal.ingest.spec_trace",
]);

/** Serial families with a handler in flight, shared across drain ticks. */
const busyFamilies = new Set<string>();

export async function handleOne(ev: EventRow, deps: LoopDeps): Promise<void> {
  const handler = deps.resolve(ev.event_name);

  if (!handler) {
    // Unknown name = config error, not transient → dead immediately.
    await deps.markDead(ev.id, `no handler for ${ev.event_name}`);

    return;
  }

  try {
    await handler(ev.params ?? {});
    await deps.markDone(ev.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const decision = decideRetry({ attempts: ev.attempts });

    if (decision.kind === "retry") {
      await deps.markFailed(ev.id, message, decision.backoffSeconds);
    } else {
      await deps.markDead(ev.id, message);
    }
  }
}

export async function drainOnce(deps: LoopDeps): Promise<number> {
  const batch = await deps.claim(deps.batchSize ?? 20, [...busyFamilies]);

  if (batch.length === 0) {
    return 0;
  }

  // handleOne swallows handler errors into the row's state; a rejection here means a
  // mark-op itself failed (e.g. DB down mid-drain) and the row is left mid-flight for
  // the reaper — surface it rather than letting it vanish.
  const logTransitionFailure = (ev: EventRow) => (reason: unknown) =>
    console.error(
      `[events] drain: transition failed for ${ev.event_name} (${ev.id}):`,
      reason,
    );

  const parallel = batch
    .filter((ev) => !SERIAL_FAMILIES.has(ev.event_name))
    .map((ev) => handleOne(ev, deps).catch(logTransitionFailure(ev)));

  const serialByFamily = new Map<string, EventRow[]>();

  for (const ev of batch.filter((e) => SERIAL_FAMILIES.has(e.event_name))) {
    serialByFamily.set(ev.event_name, [
      ...(serialByFamily.get(ev.event_name) ?? []),
      ev,
    ]);
  }

  const serial = [...serialByFamily.entries()].map(async ([family, events]) => {
    busyFamilies.add(family);

    try {
      for (const ev of events) {
        await handleOne(ev, deps).catch(logTransitionFailure(ev));
      }
    } finally {
      busyFamilies.delete(family);
    }
  });

  await Promise.all([...parallel, ...serial]);

  return batch.length;
}

/** Wire the real store + start the 1s drain. Returns the timer for shutdown/tests. */
export function startEventLoop(
  resolve: (eventName: string) => EventHandler | undefined,
  intervalMs = 1000,
): NodeJS.Timeout {
  const deps: LoopDeps = {
    resolve,
    claim: claimBatch,
    markDone,
    markFailed,
    markDead,
  };

  console.log("[events] drain loop started");

  return setInterval(() => {
    drainOnce(deps).catch((err) =>
      console.error("[events] drain tick failed:", err),
    );
  }, intervalMs);
}
