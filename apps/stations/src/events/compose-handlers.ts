import type { EventHandler } from "@re-cinq/lore-shared/project/events/drain-loop.js";

/** Adds handlers to a registry, and where a name already has one, both answer it: neither may replace the other, since each owns a different half of what the event means. */
export function addHandlers(
  registry: Map<string, EventHandler>,
  more: Map<string, EventHandler>,
): void {
  more.forEach((handler, eventName) => {
    const earlier = registry.get(eventName);

    registry.set(eventName, earlier ? bothOf(earlier, handler) : handler);
  });
}

// Both run and both are awaited, so either failing retries the delivery: each half is idempotent.
function bothOf(first: EventHandler, second: EventHandler): EventHandler {
  return async (params, meta) => {
    await Promise.all([first(params, meta), second(params, meta)]);
  };
}
