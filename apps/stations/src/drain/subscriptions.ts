// Subscriptions are derived from the manifests plus the published-node event, so a station declaring an event trigger is subscribed by that declaration alone — no drift between subscription set and registry.

import type { EventSubscription } from "@re-cinq/lore-shared/project/events/event-deliveries-port.js";
import { STATIONS } from "../stations/registry.js";
import { eventTriggerNames, nodeTriggers } from "../stations/lib/station.js";
import { SERVICE_NODE_EVENT } from "@re-cinq/lore-shared/project/events/service-node-event.js";

// One subscriber per ROLE not per replica — two stations pods share one backlog, same as two Floors.
export const STATIONS_SUBSCRIBER = "stations";

/** Fallback budget for a node whose station declares none. */
const DEFAULT_NODE_MINUTES = 10;

/** The longest a service-form node may take, so its delivery is not reaped mid-run. */
function slowestServiceNodeSeconds(): number {
  const minutes = Object.values(STATIONS)
    .flatMap((mod) => nodeTriggers(mod.manifest))
    .filter((t) => t.runtime === "service")
    .map((t) => t.timeoutMinutes);

  return Math.max(DEFAULT_NODE_MINUTES, ...minutes) * 60;
}

export function stationSubscriptions(): EventSubscription[] {
  const byName = new Map<string, EventSubscription>([
    [
      SERVICE_NODE_EVENT,
      {
        eventName: SERVICE_NODE_EVENT,
        visibilityTimeoutSeconds: slowestServiceNodeSeconds(),
      },
    ],
  ]);

  const triggeredEventNames = Object.values(STATIONS).flatMap((mod) =>
    eventTriggerNames(mod.manifest),
  );

  for (const eventName of triggeredEventNames) {
    byName.set(eventName, { eventName });
  }

  return [...byName.values()];
}
