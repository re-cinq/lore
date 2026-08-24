import type { PgPool } from "../../memory-store.js";
import { insertEvent, type EventInsert } from "../../events.js";
import type {
  EventDeliveriesPort,
  EventDeliveryRow,
  EventSubscription,
  OrphanedEvents,
} from "./event-deliveries-port.js";

/** Errors are truncated before storage to keep the row bounded. */
const MAX_ERROR_LEN = 2000;

/**
 * Postgres-backed {@link EventDeliveriesPort}.
 *
 * `insert` delegates to the shared {@link insertEvent}, which composes the
 * fan-out clause into its own statement — so the adapter has exactly one
 * definition of what inserting an event means, and this class never writes the
 * fan-out a second time.
 */
export class PgEventDeliveries implements EventDeliveriesPort {
  constructor(private readonly pool: PgPool) {}

  async subscribe(
    subscriber: string,
    subscriptions: EventSubscription[],
  ): Promise<void> {
    if (subscriptions.length === 0) {
      return;
    }

    // One statement via UNNEST rather than a loop: registration happens at boot,
    // before draining, so a partially-applied set would silently under-deliver.
    await this.pool.query(
      `INSERT INTO pipeline.event_subscriptions
              (subscriber, event_name, visibility_timeout_seconds)
       SELECT $1, name, COALESCE(timeout, 600)
         FROM UNNEST($2::text[], $3::int[]) AS t(name, timeout)
       ON CONFLICT (subscriber, event_name)
       DO UPDATE SET visibility_timeout_seconds = EXCLUDED.visibility_timeout_seconds`,
      [
        subscriber,
        subscriptions.map((s) => s.eventName),
        subscriptions.map((s) => s.visibilityTimeoutSeconds ?? null),
      ],
    );
  }

  insert(input: EventInsert): Promise<void> {
    return insertEvent(this.pool, input);
  }

  async claim(
    subscriber: string,
    limit: number,
    excludeEventNames: string[] = [],
  ): Promise<EventDeliveryRow[]> {
    // Same shape as the queue's claim — one statement, FOR UPDATE SKIP LOCKED —
    // so two replicas of one subscriber still receive disjoint batches. The join
    // carries the payload, because a handler with a delivery and no event has
    // nothing to act on.
    const { rows } = await this.pool.query<EventDeliveryRow>(
      `UPDATE pipeline.event_deliveries d
          SET status = 'processing', attempts = d.attempts + 1, claimed_at = now()
        WHERE d.id IN (
          SELECT id FROM pipeline.event_deliveries
           WHERE subscriber = $1
             AND status IN ('pending', 'failed')
             AND next_attempt_at <= now()
             AND event_name <> ALL($3::text[])
           ORDER BY next_attempt_at, id
           FOR UPDATE SKIP LOCKED
           LIMIT $2)
        RETURNING d.id, d.event_id, d.subscriber, d.event_name, d.status,
                  d.attempts, d.error, d.claimed_at, d.next_attempt_at,
                  d.handled_at, d.visibility_timeout_seconds,
                  (SELECT e.source     FROM pipeline.events e WHERE e.id = d.event_id) AS source,
                  (SELECT e.params     FROM pipeline.events e WHERE e.id = d.event_id) AS params,
                  (SELECT e.repo       FROM pipeline.events e WHERE e.id = d.event_id) AS repo`,
      [subscriber, limit, excludeEventNames],
    );

    return rows;
  }

  async markDone(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE pipeline.event_deliveries
          SET status = 'done', handled_at = now()
        WHERE id = $1`,
      [id],
    );
  }

  async markFailed(
    id: string,
    error: string,
    backoffSeconds: number,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE pipeline.event_deliveries
          SET status = 'failed', error = $2,
              next_attempt_at = now() + ($3::int || ' seconds')::interval
        WHERE id = $1`,
      [id, error.slice(0, MAX_ERROR_LEN), backoffSeconds],
    );
  }

  async markDead(id: string, error: string): Promise<void> {
    await this.pool.query(
      `UPDATE pipeline.event_deliveries
          SET status = 'dead', error = $2, handled_at = now()
        WHERE id = $1`,
      [id, error.slice(0, MAX_ERROR_LEN)],
    );
  }

  async reapStuck(): Promise<number> {
    // Each row against ITS OWN budget. A single global ceiling presumed every
    // handler dead at 600s and re-queued longer ones while they still ran.
    const { rows } = await this.pool.query(
      `UPDATE pipeline.event_deliveries
          SET status = 'failed', next_attempt_at = now()
        WHERE status = 'processing'
          AND claimed_at < now() - (visibility_timeout_seconds || ' seconds')::interval
        RETURNING id`,
    );

    return rows.length;
  }

  async pruneHandled(olderThanDays: number): Promise<number> {
    const { rows } = await this.pool.query(
      `WITH gone AS (
         DELETE FROM pipeline.event_deliveries
          WHERE status IN ('done', 'dead')
            AND handled_at < now() - ($1::int || ' days')::interval
        RETURNING id, event_id
       )
       DELETE FROM pipeline.events e
        WHERE e.captured_at < now() - ($1::int || ' days')::interval
          -- Never collect an event something is still owed a delivery of.
          AND NOT EXISTS (
            SELECT 1 FROM pipeline.event_deliveries d WHERE d.event_id = e.id
          )
          AND EXISTS (SELECT 1 FROM gone)
       RETURNING (SELECT count(*)::int FROM gone) AS pruned`,
      [olderThanDays],
    );

    return (rows[0] as { pruned?: number } | undefined)?.pruned ?? 0;
  }

  async orphanedEvents(withinMinutes: number): Promise<OrphanedEvents[]> {
    const { rows } = await this.pool.query<{
      event_name: string;
      count: string;
    }>(
      `SELECT e.event_name, count(*)::text AS count
         FROM pipeline.events e
        WHERE e.captured_at > now() - ($1::int || ' minutes')::interval
          AND NOT EXISTS (
            SELECT 1 FROM pipeline.event_deliveries d WHERE d.event_id = e.id
          )
        GROUP BY e.event_name`,
      [withinMinutes],
    );

    return rows.map((r) => ({
      event_name: r.event_name,
      count: Number(r.count),
    }));
  }
}
