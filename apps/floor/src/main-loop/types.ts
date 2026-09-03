/** Shared types for the Floor event bus: `EventInput` (listener insert), `EventRow` (loop claim), `EventHandler` (layer-3 task/job keyed by event_name). */

// Single-sourced from shared `EventInsert` to prevent two wire-shape declarations from drifting once the event-router made an external producer real.
export type { EventInsert as EventInput } from "@re-cinq/lore-shared";

// ADR-044: the Floor claims its OWN delivery, so `EventRow` carries both `id` (the delivery) and `event_id` (the event, cited when a handler passes a payload BY REFERENCE).
export type { EventDeliveryRow as EventRow } from "@re-cinq/lore-shared/project/events/event-deliveries-port.js";

/** A layer-3 handler; self-sources its own deps, params carry the event payload. */
/** Row identity a handler may need to hand a large payload off by reference instead of copying it. */
export interface EventMeta {
  eventId: string;
}

export type EventHandler = (
  params: Record<string, unknown>,
  meta?: EventMeta,
) => Promise<void>;
