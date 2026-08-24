/**
 * What this service does with each delivery it claims.
 *
 * One handler per subscribed event name, resolved the same way the Floor's
 * registry resolves its own — so both drainers behave identically about retry,
 * dead-lettering and the visibility budget.
 */

import type { EventHandler } from "@re-cinq/lore-shared/project/events/drain-loop.js";
import { runPublishedNode, type PublishedNode } from "../kernel/run-node.js";

/** Published by the walk when a node's station runs here rather than in a pod. */
export const SERVICE_NODE_EVENT = "station.run";

/**
 * Run a node the walk published for this service.
 *
 * The outcome goes back over `assembly_run.resume` — the channel a person
 * reports through from the wizard — so the walk converges whichever worker ran
 * the node.
 */
const runNode: EventHandler = async (params) => {
  const { reportToParkedNode } =
    await import("@re-cinq/lore-shared/project/assembly-runs/parked-node.js");
  const { eventReporter } = await import("../kernel/queues.js");

  await runPublishedNode(
    params as unknown as PublishedNode,
    (target, outcome, args, result) =>
      reportToParkedNode(eventReporter(), target, outcome, args, result),
  );
};

export function buildStationHandlers(): Map<string, EventHandler> {
  return new Map<string, EventHandler>([[SERVICE_NODE_EVENT, runNode]]);
}
