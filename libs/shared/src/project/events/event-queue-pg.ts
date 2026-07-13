import type { PgPool } from "../../memory-store.js";
import { insertEvent, type EventInsert } from "../../events.js";
import type { EventQueueRepository, EventRow } from "./event-queue-port.js";

/** Errors are truncated before storage to keep the row bounded. */
const MAX_ERROR_LEN = 2000;

/**
 * Postgres-backed {@link EventQueueRepository}. The consume-side SQL moved here
 * verbatim from the Floor `main-loop/store.ts`; `insert` delegates to the shared
 * {@link insertEvent} writer so the INSERT stays single-sourced.
 */
export class PgEventQueue implements EventQueueRepository {
  constructor(private readonly pool: PgPool) {}

  insert(input: EventInsert): Promise<void> {
    return insertEvent(this.pool, input);
  }

  async claimBatch(limit: number): Promise<EventRow[]> {
    const { rows } = await this.pool.query(
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
    return rows as EventRow[];
  }

  async markDone(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE pipeline.events SET status = 'done', handled_at = now() WHERE id = $1`,
      [id],
    );
  }

  async markFailed(
    id: string,
    error: string,
    backoffSeconds: number,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE pipeline.events
          SET status = 'failed', error = $2,
              next_attempt_at = now() + ($3::int || ' seconds')::interval
        WHERE id = $1`,
      [id, error.slice(0, MAX_ERROR_LEN), backoffSeconds],
    );
  }

  async markDead(id: string, error: string): Promise<void> {
    await this.pool.query(
      `UPDATE pipeline.events SET status = 'dead', error = $2, handled_at = now() WHERE id = $1`,
      [id, error.slice(0, MAX_ERROR_LEN)],
    );
  }

  async reapStuck(timeoutSeconds: number): Promise<number> {
    const { rows } = await this.pool.query(
      `UPDATE pipeline.events
          SET status = 'failed', next_attempt_at = now()
        WHERE status = 'processing'
          AND claimed_at < now() - ($1::int || ' seconds')::interval
        RETURNING id`,
      [timeoutSeconds],
    );
    return rows.length;
  }

  async pruneHandled(olderThanDays: number): Promise<number> {
    const { rows } = await this.pool.query(
      `DELETE FROM pipeline.events
        WHERE status IN ('done', 'dead')
          AND handled_at < now() - ($1::int || ' days')::interval
        RETURNING id`,
      [olderThanDays],
    );
    return rows.length;
  }
}
