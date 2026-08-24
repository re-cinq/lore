import type { EventInsert } from "../../events.js";

/**
 * One subscriber's copy of an event, joined with the event it delivers.
 *
 * `id` is the delivery's bigint as a string (pg); `event_id` is the event's.
 * The event's own columns ride along because a handler needs the payload, and
 * fetching it separately would let a pruned event hand back a delivery with
 * nothing in it.
 */
export interface EventDeliveryRow {
  id: string;
  event_id: string;
  subscriber: string;
  event_name: string;
  source: string;
  params: Record<string, unknown>;
  repo: string | null;
  status: string;
  attempts: number;
  error: string | null;
  claimed_at: string | null;
  next_attempt_at: string;
  handled_at: string | null;
  visibility_timeout_seconds: number;
}

/** What a subscriber asks for: an event name, and how long its handler may take. */
export interface EventSubscription {
  eventName: string;
  /** Defaults to the table's 600s. Stamped onto each delivery at fan-out. */
  visibilityTimeoutSeconds?: number;
}

/** An event name nobody subscribed to, with how many such events are pending. */
export interface OrphanedEvents {
  event_name: string;
  count: number;
}

/**
 * The `pipeline.event_deliveries` mechanics: a subscriber registers what it
 * wants, then claims, acks, fails and dead-letters its OWN deliveries. Two
 * subscribers of one event get a row each, so neither can steal from or starve
 * the other, and one that was offline drains its own backlog when it returns.
 *
 * `insert` is here rather than only on the queue because fan-out happens INSIDE
 * the insert statement (see fan-out.ts) — an implementation that could not
 * insert could not be held to the delivery contract at all.
 */
export interface EventDeliveriesPort {
  /** Register (idempotently) the events this subscriber reacts to. */
  subscribe(
    subscriber: string,
    subscriptions: EventSubscription[],
  ): Promise<void>;
  /** Insert one event, fanning it out to its subscribers in the same statement. */
  insert(input: EventInsert): Promise<void>;
  /**
   * Atomically claim up to `limit` of THIS subscriber's runnable deliveries.
   *
   * `excludeEventNames` holds back a busy serial family at CLAIM time, so its
   * waiting rows stay `pending` — parking them in `processing` behind an
   * in-process queue would get them reaped as presumed-dead and re-run
   * concurrently anyway.
   */
  claim(
    subscriber: string,
    limit: number,
    excludeEventNames?: string[],
  ): Promise<EventDeliveryRow[]>;
  markDone(id: string): Promise<void>;
  markFailed(id: string, error: string, backoffSeconds: number): Promise<void>;
  markDead(id: string, error: string): Promise<void>;
  /**
   * Return deliveries whose claimer never finished, each judged against ITS OWN
   * `visibility_timeout_seconds` rather than one global ceiling; returns the count.
   */
  reapStuck(): Promise<number>;
  /**
   * Delete terminal deliveries older than `olderThanDays`; returns the count.
   * An event with an unhandled delivery is never collected.
   */
  pruneHandled(olderThanDays: number): Promise<number>;
  /**
   * Events captured within `withinMinutes` that no subscriber received.
   *
   * The failure this design introduces: an unsubscribed name used to be a loud
   * dead-letter and is now silence. This is what makes it audible.
   */
  orphanedEvents(withinMinutes: number): Promise<OrphanedEvents[]>;
}
