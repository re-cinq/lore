// The Floor's view of `pipeline.events`, now owned by the event-router (ADR-044) — this module stays as the seam every Floor caller already imports.

import { deliveries, eventProxy, eventReporter } from "../kernel/queues.js";
import type { EventSubscription } from "@re-cinq/lore-shared/project/events/event-deliveries-port.js";
import type { EventInput, EventRow } from "../kernel/event-types.js";

/** Counterpart to {@link insertEvent} for producers with nobody to return a status to — hands off to the proxy, which retries and reports failure itself. */
export function emitEvent(input: EventInput): Promise<void> {
  return eventProxy().emit({ kind: "event", event: input });
}

export function insertEvent(input: EventInput): Promise<void> {
  return eventReporter().insert(input);
}

/** A failed insert PROPAGATES (never swallowed) so the route 5xxs and the sender redelivers — every insert is idempotent, so redelivery is safe. */
export function insertEventList(
  events: EventInput[],
  source: string,
): Promise<void> {
  return logAndRethrow(
    Promise.all(events.map((ev) => insertEvent(ev))).then(() => undefined),
    `[events] ${source} insert failed:`,
  );
}

/** Log a rejection where operators look, then rethrow unchanged — swallowing here would 2xx the sender for lost work. */
async function logAndRethrow<T>(work: Promise<T>, label: string): Promise<T> {
  try {
    return await work;
  } catch (err) {
    console.error(label, err);
    throw err;
  }
}

/** One subscriber per ROLE, not per replica — two Floors share a backlog; `SKIP LOCKED` gives them disjoint batches. */
export const FLOOR_SUBSCRIBER = "floor";

/** Called at boot BEFORE the loop starts — fan-out reads the subscription set at insert time, so an event captured earlier is delivered to nobody. */
export function subscribe(subscriptions: EventSubscription[]): Promise<void> {
  return deliveries().subscribe(FLOOR_SUBSCRIBER, subscriptions);
}

/** Repair deliveries fan-out could not create — see the port's contract. */
export function reconcileDeliveries(withinMinutes: number): Promise<number> {
  return deliveries().reconcileDeliveries(withinMinutes);
}

/** Atomically claim up to `limit` of this Floor's runnable deliveries. */
export function claimBatch(
  limit: number,
  excludeEventNames: string[] = [],
): Promise<EventRow[]> {
  return deliveries().claim(FLOOR_SUBSCRIBER, limit, excludeEventNames);
}

export function markDone(id: string): Promise<void> {
  return deliveries().markDone(id);
}

export function markFailed(
  id: string,
  error: string,
  backoffSeconds: number,
): Promise<void> {
  return deliveries().markFailed(id, error, backoffSeconds);
}

export function markDead(id: string, error: string): Promise<void> {
  return deliveries().markDead(id, error);
}

/** Deliveries a crashed claimer left in flight; each row is judged against its own subscriber's declared budget, not one global ceiling. */
export function reapStuck(): Promise<number> {
  return deliveries().reapStuck();
}

/** Delete old terminal deliveries to keep the claim index small. */
export function pruneHandled(olderThanDays: number): Promise<number> {
  return deliveries().pruneHandled(olderThanDays);
}

/** Events captured recently that no subscriber received — the silent case. */
export function orphanedEvents(withinMinutes: number) {
  return deliveries().orphanedEvents(withinMinutes);
}
