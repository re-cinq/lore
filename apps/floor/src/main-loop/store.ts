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
