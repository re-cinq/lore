/**
 * Event sources moved to `@re-cinq/lore-shared` when the event-router became a
 * separate deployable (ADR-044): a producer outside this process has to name a
 * source too, and a vocabulary only one speaker can see is not a vocabulary.
 * Re-exported because Floor's modules have always imported it from here.
 */

export { SOURCES, type EventSource } from "@re-cinq/lore-shared";
