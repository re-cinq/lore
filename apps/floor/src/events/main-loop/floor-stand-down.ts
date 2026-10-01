import { floorConfigured } from "@re-cinq/lore-shared/floor/floor-client.js";
import type { EventHandler } from "../../domain/event-types.js";

/** A tick whose work the external floor does where one is configured (the spec-upkeep line replaces both spec-drift and the link backfill there): this Floor's handler then stands down, so one engine edits a repository's specs, never both. */
export function unlessOnTheFloor(handler: EventHandler): EventHandler {
  return (params) => (floorConfigured() ? Promise.resolve() : handler(params));
}

/** A tick this Floor only emits: the stations service consumes it. Registered because every emitter must have a handler here. */
export const takenByStations: EventHandler = () => Promise.resolve();
