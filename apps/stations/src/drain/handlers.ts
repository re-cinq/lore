// One handler per subscribed event name, resolved the same way the Floor's registry does, so both drainers agree on retry, dead-lettering, and the visibility budget.

import { SERVICE_NODE_EVENT } from "@re-cinq/lore-shared/project/events/service-node-event.js";
import type { EventHandler } from "@re-cinq/lore-shared/project/events/drain-loop.js";
import { runPublishedNode, parsePublishedNode } from "../kernel/run-node.js";
import { STATIONS } from "../stations/registry.js";
import {
  eventTriggerNames,
  isSweepModule,
  type SweepStationModule,
} from "../stations/lib/station.js";
import { stationHost } from "../kernel/station-host.js";

/** Published by the walk when a node's station runs here rather than in a pod. */

// Runs a node the walk published here; reports the outcome back over assembly_run.resume so the walk converges regardless of which worker ran it.
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

// Runs the sweep that declared this event trigger — derived from the manifests like the subscription set, so a station can't subscribe without a handler and get silently dead-lettered.
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

  const sweepBindings = Object.values(STATIONS)
    .filter(isSweepModule)
    .flatMap((mod) =>
      eventTriggerNames(mod.manifest).map((eventName) => ({ mod, eventName })),
    );

  for (const { mod, eventName } of sweepBindings) {
    handlers.set(eventName, runSweepFor(mod, eventName));
  }

  return handlers;
}
