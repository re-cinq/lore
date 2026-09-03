import type { EventInsert } from "../../events.js";

/** One subscriber's copy of an event, joined with the event it delivers (id/event_id are pg bigints as strings); event columns ride along so a handler always has its payload, even after the event is pruned. */
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

/** pipeline.event_deliveries mechanics: a subscriber registers, then claims/acks/fails/dead-letters its own deliveries (one row per subscriber, so neither steals from nor starves the other). insert lives here since fan-out happens inside the insert statement (fan-out.ts). */
export interface EventDeliveriesPort {
  /** Register (idempotently) the events this subscriber reacts to. */
  subscribe(
    subscriber: string,
    subscriptions: EventSubscription[],
  ): Promise<void>;
  /** Insert one event, fanning it out to its subscribers in the same statement. */
  insert(input: EventInsert): Promise<void>;
  /** Atomically claims up to `limit` of this subscriber's runnable deliveries; excludeEventNames holds back a busy serial family at claim time so its rows stay pending (not processing, which the reaper would presume dead). */
  claim(
    subscriber: string,
    limit: number,
    excludeEventNames?: string[],
  ): Promise<EventDeliveryRow[]>;
  markDone(id: string): Promise<void>;
  markFailed(id: string, error: string, backoffSeconds: number): Promise<void>;
  markDead(id: string, error: string): Promise<void>;
  /** Returns deliveries whose claimer never finished, each judged against its own visibility_timeout_seconds rather than a global ceiling; returns the count. */
  reapStuck(): Promise<number>;
  /** Deletes terminal deliveries older than olderThanDays (an event with an unhandled delivery is never collected); returns the count. */
  pruneHandled(olderThanDays: number): Promise<number>;
  /** Events captured within withinMinutes that no subscriber received — makes an unsubscribed name audible instead of silent. */
  orphanedEvents(withinMinutes: number): Promise<OrphanedEvents[]>;
  /** Creates the deliveries fan-out couldn't (a subscriber not yet registered at insert time), repairing the deploy-order gap; idempotent via the same (event_id, subscriber) uniqueness fan-out uses. withinMinutes must stay well inside the prune window or a pruned delivery gets recreated and re-run. */
  reconcileDeliveries(withinMinutes: number): Promise<number>;
}

/** How far back a boot looks for undelivered events — longer than a rollout, far shorter than the prune window (see {@link EventDeliveriesPort.reconcileDeliveries}); shared so both drainers agree. */
export const RECONCILE_WINDOW_MINUTES = 60;
