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

/** Postgres-backed EventDeliveriesPort; insert delegates to the shared insertEvent so the fan-out clause is defined exactly once. */
export class PgEventDeliveries implements EventDeliveriesPort {
  constructor(private readonly pool: PgPool) {}

  async subscribe(
    subscriber: string,
    subscriptions: EventSubscription[],
  ): Promise<void> {
    // Empty set means "nothing to say", not "unsubscribe from everything" — else a boot that computed handlers wrongly would silently take the subscriber off the bus.
    if (subscriptions.length === 0) {
      return;
    }

    // One statement via UNNEST (not a loop): registration happens at boot before draining, so a partial apply would silently under-deliver.
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

    // Boot registration declares the subscriber's whole set — a name absent is a removed handler; left behind it keeps drawing deliveries nobody runs. Scoped to this subscriber only.
    await this.pool.query(
      `DELETE FROM pipeline.event_subscriptions
        WHERE subscriber = $1
          AND event_name <> ALL($2::text[])`,
      [subscriber, subscriptions.map((s) => s.eventName)],
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
    // Same shape as the queue's claim (FOR UPDATE SKIP LOCKED) so replicas get disjoint batches; join carries the payload since a delivery with no event has nothing to act on.
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
    // Each row against its own budget — a single global ceiling presumed every handler dead at 600s and re-queued longer ones still running.
    const { rows } = await this.pool.query(
      `UPDATE pipeline.event_deliveries
          SET status = 'failed', next_attempt_at = now()
        WHERE status = 'processing'
          AND claimed_at < now() - (visibility_timeout_seconds || ' seconds')::interval
        RETURNING id`,
    );

    return rows.length;
  }

  async reconcileDeliveries(withinMinutes: number): Promise<number> {
    // Same INSERT…SELECT fan-out, widened to a window of events; ON CONFLICT makes a boot-time repair free when there's nothing to repair.
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO pipeline.event_deliveries
              (event_id, subscriber, event_name, visibility_timeout_seconds)
       SELECT e.id, s.subscriber, e.event_name, s.visibility_timeout_seconds
         FROM pipeline.events e
         JOIN pipeline.event_subscriptions s ON s.event_name = e.event_name
        WHERE e.captured_at > now() - ($1::int || ' minutes')::interval
       ON CONFLICT (event_id, subscriber) DO NOTHING
       RETURNING id`,
      [withinMinutes],
    );

    return rows.length;
  }

  async pruneHandled(olderThanDays: number): Promise<number> {
    // Two statements deliberately (not one CTE): a composed event DELETE read the pre-delete snapshot, so a quiet sweep (no deliveries pruned) collected no events and pipeline.events grew unbounded. Prune is janitorial — no transaction needed.
    const { rows: deliveries } = await this.pool.query<{ id: string }>(
      `DELETE FROM pipeline.event_deliveries
        WHERE status IN ('done', 'dead')
          AND handled_at < now() - ($1::int || ' days')::interval
       RETURNING id`,
      [olderThanDays],
    );

    await this.pool.query(
      `DELETE FROM pipeline.events e
        WHERE e.captured_at < now() - ($1::int || ' days')::interval
          -- Never collect an event something is still owed a delivery of.
          AND NOT EXISTS (
            SELECT 1 FROM pipeline.event_deliveries d WHERE d.event_id = e.id
          )`,
      [olderThanDays],
    );

    // Deliveries pruned, per the port — event collection is bookkeeping behind it; counting both would conflate two different numbers.
    return deliveries.length;
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
