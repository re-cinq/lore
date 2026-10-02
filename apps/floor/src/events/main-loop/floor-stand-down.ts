import type { EventHandler } from "../../domain/event-types.js";

/** A tick the stations service consumes. Registered here because this process subscribes to every tick, and one with no handler dead-letters. */
export const takenByStations: EventHandler = () => Promise.resolve();
