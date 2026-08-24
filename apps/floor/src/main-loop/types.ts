/**
 * Shared types for the Floor event bus. An `EventInput` is what a listener
 * (layer 1) inserts; an `EventRow` is what the loop (layer 2) claims; an
 * `EventHandler` is a task/job (layer 3) keyed by event_name in the registry.
 */

// What a listener inserts. The shape is the shared `EventInsert` — it was
// declared identically in both places until the event-router made a producer
// outside this process real, and two declarations of one wire shape is how they
// drift. `EventInput` stays as the name Floor's ~20 listener modules import.
export type { EventInsert as EventInput } from "@re-cinq/lore-shared";

// The claimed-row shape is single-sourced from the shared event-queue port
// (project.events); the loop/store here operate on exactly that row.
export type { EventRow } from "@re-cinq/lore-shared/project/events/event-queue-port.js";

/** A layer-3 handler. Self-sources its own deps (DB pool, platform); params carry the event payload. */
/** Row identity a handler may need (e.g. to hand a large payload off by
 *  reference instead of copying it); handlers that don't care ignore it. */
export interface EventMeta {
  eventId: string;
}

export type EventHandler = (
  params: Record<string, unknown>,
  meta?: EventMeta,
) => Promise<void>;
