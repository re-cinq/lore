/**
 * This service's drain loop.
 *
 * Without it a service-form node is published by the walk and claimed by
 * nobody: `advanceLine` stops creating an Agent CR for those nodes, so the visit
 * simply sits open until the reaper times it out. That makes this a
 * PREREQUISITE for the merge line rather than an optimisation — `merge_step` has
 * no pod recipe to fall back to.
 *
 * Uses the SAME loop as the Floor, so both drainers share one retry ladder, one
 * attempt cap and one dead-letter rule. A second implementation is how they
 * would come to disagree about when work is abandoned.
 */

import {
  startEventLoop,
  type EventHandler,
} from "@re-cinq/lore-shared/project/events/drain-loop.js";
import type {
  EventDeliveryRow,
  EventSubscription,
} from "@re-cinq/lore-shared/project/events/event-deliveries-port.js";
import { buildStationHandlers } from "./handlers.js";
import { stationSubscriptions, STATIONS_SUBSCRIBER } from "./subscriptions.js";

export interface StationDrainDeps {
  subscribe(
    subscriber: string,
    subscriptions: EventSubscription[],
  ): Promise<void>;
  claim(
    subscriber: string,
    limit: number,
    excludeEventNames?: string[],
  ): Promise<EventDeliveryRow[]>;
  markDone(id: string): Promise<void>;
  markFailed(id: string, error: string, backoffSeconds: number): Promise<void>;
  markDead(id: string, error: string): Promise<void>;
}

export async function startStationDrain(
  deps: StationDrainDeps,
  intervalMs = 1000,
  handlers: Map<string, EventHandler> = buildStationHandlers(),
): Promise<NodeJS.Timeout> {
  // BEFORE the loop, and awaited: fan-out reads the subscription set at INSERT
  // time, so an event captured before this lands is delivered to nobody. A
  // failure here must stop the boot rather than leave a drainer claiming an
  // empty set forever, which looks exactly like having nothing to do.
  await deps.subscribe(STATIONS_SUBSCRIBER, stationSubscriptions());

  return startEventLoop(
    {
      resolve: (name) => handlers.get(name),
      claim: (limit, exclude) =>
        deps.claim(STATIONS_SUBSCRIBER, limit, exclude),
      markDone: deps.markDone,
      markFailed: deps.markFailed,
      markDead: deps.markDead,
    },
    intervalMs,
  );
}
