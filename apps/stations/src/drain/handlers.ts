/**
 * What this service does with each delivery it claims.
 *
 * One handler per subscribed event name, resolved the same way the Floor's
 * registry resolves its own — so both drainers behave identically about retry,
 * dead-lettering and the visibility budget.
 */

import { SERVICE_NODE_EVENT } from "@re-cinq/lore-shared/project/events/service-node-event.js";
import type { EventHandler } from "@re-cinq/lore-shared/project/events/drain-loop.js";
import { runPublishedNode, parsePublishedNode } from "../kernel/run-node.js";
import { STATIONS } from "../stations/registry.js";
import {
  isSweepModule,
  type SweepStationModule,
} from "../stations/lib/station.js";
import { stationHost } from "../kernel/station-host.js";

/** Published by the walk when a node's station runs here rather than in a pod. */

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
    parsePublishedNode(params),
    (target, outcome, args, result) =>
      reportToParkedNode(eventReporter(), target, outcome, args, result),
  );
};

/**
 * Run the sweep that declared this event as a trigger.
 *
 * Derived from the manifests, exactly as the subscription set is, so a station
 * declaring an event trigger gets both the subscription AND the handler from one
 * declaration. Subscribing without handling is worse than not subscribing: the
 * delivery arrives, finds no handler, and is dead-lettered on the spot — the
 * advertised fast path silently never runs while its cron reconciler masks it.
 */
const runSweepFor =
  (mod: SweepStationModule, eventName: string): EventHandler =>
  async (params, meta) => {
    const summary = await mod.run({
      trigger: "event",
      event: { name: eventName, params, eventId: meta?.eventId ?? "" },
      host: stationHost(),
    });

    console.log(`[station] ${mod.manifest.name}: ${summary}`);
  };

export function buildStationHandlers(): Map<string, EventHandler> {
  const handlers = new Map<string, EventHandler>([
    [SERVICE_NODE_EVENT, runNode],
  ]);

  for (const mod of Object.values(STATIONS)) {
    if (!isSweepModule(mod)) {
      continue;
    }

    for (const trigger of mod.manifest.triggers) {
      if (trigger.kind !== "event") {
        continue;
      }

      for (const eventName of trigger.eventNames) {
        handlers.set(eventName, runSweepFor(mod, eventName));
      }
    }
  }

  return handlers;
}
