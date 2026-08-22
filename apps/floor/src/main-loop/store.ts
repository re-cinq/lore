/**
 * The Floor's view of `pipeline.events` — a table it no longer owns (ADR-044).
 *
 * Both halves go through the event-router: producers insert (idempotent via
 * dedupe_key), the loop claims a batch and transitions each row
 * done/failed/dead, the reaper recovers rows a crash left in `processing`. The
 * claim is still atomic — `FOR UPDATE SKIP LOCKED` is one statement, and it now
 * runs on the router's side of the call rather than this one.
 *
 * This module stays as the seam every Floor caller already imports, which is
 * what let the whole write and consume path move without touching them.
 */

import { eventQueue, eventReporter } from "../kernel/queues.js";
import type { EventInput, EventRow } from "./types.js";

/**
 * Report an event.
 *
 * Goes through the event-router (ADR-044), not the pool: `pipeline.events` has
 * one writer, and this is the single seam every Floor producer — the cron
 * emitter, the CI ingress, the reconcile pass — already inserts through, so
 * routing it here routes all of them.
 *
 * The consume side below reports through the router too — the Floor drains a
 * queue it neither owns nor writes to.
 */
export function insertEvent(input: EventInput): Promise<void> {
  return eventReporter().insert(input);
}

/**
 * Insert many events concurrently. A failed insert PROPAGATES (logged, tagged with
 * `source`, then rethrown) — it must not be swallowed: the webhook/CI routes return
 * 202 on success, so a silently-dropped insert would tell GitHub/CI the delivery was
 * captured when it was lost, and a 2xx means the sender never redelivers. Letting it
 * surface makes the route return 5xx so the sender retries; every insert is idempotent
 * (dedupe_key where present, content-hash otherwise), so redelivery is safe.
 */
export function insertEventList(
  events: EventInput[],
  source: string,
): Promise<void> {
  return logAndRethrow(
    Promise.all(events.map((ev) => insertEvent(ev))).then(() => undefined),
    `[events] ${source} insert failed:`,
  );
}

/**
 * Log a rejection where operators look, then let it through UNCHANGED.
 *
 * The rethrow is the whole point (see `insertEventList` above): swallowing here
 * would answer the sender 2xx for work that was lost. Naming the shape says that
 * out loud, where a bare try/catch reads like a place someone might later be
 * tempted to stop rethrowing from.
 */
async function logAndRethrow<T>(work: Promise<T>, label: string): Promise<T> {
  try {
    return await work;
  } catch (err) {
    console.error(label, err);
    throw err;
  }
}

/** Atomically claim up to `limit` runnable rows: pending/failed past their backoff. */
export function claimBatch(
  limit: number,
  excludeEventNames: string[] = [],
): Promise<EventRow[]> {
  return eventQueue().claimBatch(limit, excludeEventNames);
}

export function markDone(id: string): Promise<void> {
  return eventQueue().markDone(id);
}

export function markFailed(
  id: string,
  error: string,
  backoffSeconds: number,
): Promise<void> {
  return eventQueue().markFailed(id, error, backoffSeconds);
}

export function markDead(id: string, error: string): Promise<void> {
  return eventQueue().markDead(id, error);
}

/** Reset rows stuck in `processing` (claimer crashed) back to failed so they re-run. */
export function reapStuck(timeoutSeconds: number): Promise<number> {
  return eventQueue().reapStuck(timeoutSeconds);
}

/** Delete old terminal rows to keep the claim index small. */
export function pruneHandled(olderThanDays: number): Promise<number> {
  return eventQueue().pruneHandled(olderThanDays);
}
