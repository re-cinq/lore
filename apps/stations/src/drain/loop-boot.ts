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

/** How hard boot tries to register before giving up. */
export interface SubscribeRetry {
  attempts: number;
  delayMs: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Register, retrying a transient refusal.
 *
 * This service and the router come up together — under `npm start` they race,
 * and in a cluster a rollout reorders them — so the first attempt can hit a
 * router that is not listening yet. Fataling on that leaves the service dead
 * with the router healthy seconds later, which is what happens without this.
 * Retrying does not weaken the guard below: the boot still fails if the last
 * attempt fails, because a drainer claiming an unregistered set looks exactly
 * like one with nothing to do.
 */
async function subscribeWithRetry(
  deps: StationDrainDeps,
  retry: SubscribeRetry,
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await deps.subscribe(STATIONS_SUBSCRIBER, stationSubscriptions());

      return;
    } catch (err) {
      if (attempt >= retry.attempts) {
        throw err;
      }
      console.warn(
        `[stations] subscribe attempt ${attempt}/${retry.attempts} failed (${(err as Error).message}) — retrying`,
      );
      await sleep(retry.delayMs * attempt);
    }
  }
}

export async function startStationDrain(
  deps: StationDrainDeps,
  intervalMs = 1000,
  handlers: Map<string, EventHandler> = buildStationHandlers(),
  retry: SubscribeRetry = { attempts: 10, delayMs: 1000 },
): Promise<NodeJS.Timeout> {
  // BEFORE the loop, and awaited: fan-out reads the subscription set at INSERT
  // time, so an event captured before this lands is delivered to nobody.
  await subscribeWithRetry(deps, retry);

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
