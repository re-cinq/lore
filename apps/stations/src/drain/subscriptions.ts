/**
 * What this service asks the bus to deliver it.
 *
 * DERIVED from the manifests plus the published-node event, so a station that
 * declares an event trigger is subscribed by that declaration alone — the
 * subscription set and the registry cannot drift into disagreeing.
 */

import type { EventSubscription } from "@re-cinq/lore-shared/project/events/event-deliveries-port.js";
import { STATIONS } from "../stations/registry.js";
import { nodeTriggers } from "../stations/lib/station.js";
import { SERVICE_NODE_EVENT } from "@re-cinq/lore-shared/project/events/service-node-event.js";

/**
 * One subscriber per ROLE, not per replica: two stations pods are the same
 * consumer and must share a backlog, exactly as two Floors do.
 */
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

  for (const mod of Object.values(STATIONS)) {
    for (const trigger of mod.manifest.triggers) {
      if (trigger.kind !== "event") {
        continue;
      }

      for (const eventName of trigger.eventNames) {
        byName.set(eventName, { eventName });
      }
    }
  }

  return [...byName.values()];
}
