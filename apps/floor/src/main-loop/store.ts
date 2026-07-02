/**
 * The pipeline.events data layer. The SQL now lives once in the shared
 * `PgEventQueue` (`@re-cinq/lore-shared/project/events`); this module is the
 * thin Floor-side delegation so producers/loop/reaper keep their existing
 * imports. Producers insert (idempotent via dedupe_key); the loop claims a batch
 * atomically (FOR UPDATE SKIP LOCKED) and transitions each row done/failed/dead;
 * the reaper recovers rows stuck in `processing` by a crash.
 */

import { eventQueue } from "../kernel/queues.js";
import type { EventInput, EventRow } from "./types.js";

export function insertEvent(input: EventInput): Promise<void> {
  return eventQueue().insert(input);
}

/**
 * Insert many events concurrently. A failed insert PROPAGATES (logged, tagged with
 * `source`, then rethrown) — it must not be swallowed: the webhook/CI routes return
 * 202 on success, so a silently-dropped insert would tell GitHub/CI the delivery was
 * captured when it was lost, and a 2xx means the sender never redelivers. Letting it
 * surface makes the route return 5xx so the sender retries; every insert is idempotent
 * (dedupe_key where present, content-hash otherwise), so redelivery is safe.
 */
export async function insertEventList(events: EventInput[], source: string): Promise<void> {
  try {
    await Promise.all(events.map((ev) => insertEvent(ev)));
  } catch (err) {
    console.error(`[events] ${source} insert failed:`, err);
    throw err;
  }
}

/** Atomically claim up to `limit` runnable rows: pending/failed past their backoff. */
export function claimBatch(limit: number): Promise<EventRow[]> {
  return eventQueue().claimBatch(limit);
}

export function markDone(id: string): Promise<void> {
  return eventQueue().markDone(id);
}

export function markFailed(id: string, error: string, backoffSeconds: number): Promise<void> {
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
