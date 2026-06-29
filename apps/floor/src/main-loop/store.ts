/**
 * The pipeline.events data layer: producers insert (idempotent via dedupe_key);
 * the loop claims a batch atomically (FOR UPDATE SKIP LOCKED — HA-safe even though
 * Floor is a singleton today) and transitions each row done/failed/dead; the
 * reaper recovers rows stuck in `processing` by a crash.
 */

import { query } from "../kernel/db.js";
import type { EventInput, EventRow } from "./types.js";

export async function insertEvent(input: EventInput): Promise<void> {
  await query(
    `INSERT INTO pipeline.events (event_name, source, params, dedupe_key)
     VALUES ($1, $2, $3::jsonb, $4)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [input.eventName, input.source, JSON.stringify(input.params ?? {}), input.dedupeKey ?? null],
  );
}

/** Atomically claim up to `limit` runnable rows: pending/failed past their backoff. */
export async function claimBatch(limit: number): Promise<EventRow[]> {
  return query<EventRow>(
    `UPDATE pipeline.events e
        SET status = 'processing', attempts = attempts + 1, claimed_at = now()
      WHERE e.id IN (
        SELECT id FROM pipeline.events
         WHERE status IN ('pending', 'failed') AND next_attempt_at <= now()
         ORDER BY next_attempt_at, id
         FOR UPDATE SKIP LOCKED
         LIMIT $1)
      RETURNING e.*`,
    [limit],
  );
}

export async function markDone(id: string): Promise<void> {
  await query(`UPDATE pipeline.events SET status = 'done', handled_at = now() WHERE id = $1`, [id]);
}

export async function markFailed(id: string, error: string, backoffSeconds: number): Promise<void> {
  await query(
    `UPDATE pipeline.events
        SET status = 'failed', error = $2,
            next_attempt_at = now() + ($3::int || ' seconds')::interval
      WHERE id = $1`,
    [id, error.slice(0, 2000), backoffSeconds],
  );
}

export async function markDead(id: string, error: string): Promise<void> {
  await query(
    `UPDATE pipeline.events SET status = 'dead', error = $2, handled_at = now() WHERE id = $1`,
    [id, error.slice(0, 2000)],
  );
}

/** Reset rows stuck in `processing` (claimer crashed) back to failed so they re-run. */
export async function reapStuck(timeoutSeconds: number): Promise<number> {
  const rows = await query<{ id: string }>(
    `UPDATE pipeline.events
        SET status = 'failed', next_attempt_at = now()
      WHERE status = 'processing'
        AND claimed_at < now() - ($1::int || ' seconds')::interval
      RETURNING id`,
    [timeoutSeconds],
  );
  return rows.length;
}

/** Delete old terminal rows to keep the claim index small. */
export async function pruneHandled(olderThanDays: number): Promise<number> {
  const rows = await query<{ id: string }>(
    `DELETE FROM pipeline.events
      WHERE status IN ('done', 'dead')
        AND handled_at < now() - ($1::int || ' days')::interval
      RETURNING id`,
    [olderThanDays],
  );
  return rows.length;
}
