// This service's drain loop, a PREREQUISITE (not an optimisation): a published service-form node is claimed by nobody without it and merge_step has no pod fallback; uses the same loop as the Floor so both drainers agree on retry/dead-letter behavior.

import {
  startEventLoop,
  type EventHandler,
} from "@re-cinq/lore-shared/project/events/drain-loop.js";
import {
  RECONCILE_WINDOW_MINUTES,
  type EventDeliveriesPort,
} from "@re-cinq/lore-shared/project/events/event-deliveries-port.js";
import { buildStationHandlers } from "./handlers.js";
import { stationSubscriptions, STATIONS_SUBSCRIBER } from "./subscriptions.js";

/** The half of the deliveries port a drainer uses, derived so it cannot drift from what it narrows. */
export type StationDrainDeps = Pick<
  EventDeliveriesPort,
  | "subscribe"
  | "claim"
  | "markDone"
  | "markFailed"
  | "markDead"
  | "reconcileDeliveries"
>;

/** How hard boot tries to register before giving up. */
export interface SubscribeRetry {
  attempts: number;
  delayMs: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Retries subscribe on boot since this service and the router race up (npm start) or reorder (rollout); still fails hard on the last attempt, since an unregistered drainer looks identical to an idle one.
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

/** Repairs events published before this boot's subscription existed — fan-out creates delivery rows at insert time, so those events have none and nobody is waiting to claim them. Failure is swallowed: a drainer that cannot repair should still drain. */
async function repairMissedDeliveries(deps: StationDrainDeps): Promise<void> {
  try {
    const repaired = await deps.reconcileDeliveries(RECONCILE_WINDOW_MINUTES);

    if (repaired > 0) {
      console.log(
        `[stations] reconciled ${repaired} deliveries missed before this boot registered`,
      );
    }
  } catch (err) {
    console.warn(
      `[stations] boot reconcile failed (${(err as Error).message}) — draining anyway`,
    );
  }
}

export async function startStationDrain(
  deps: StationDrainDeps,
  intervalMs = 1000,
  handlers: Map<string, EventHandler> = buildStationHandlers(),
  retry: SubscribeRetry = { attempts: 10, delayMs: 1000 },
): Promise<NodeJS.Timeout> {
  // Awaited before the loop — fan-out reads the subscription set at insert time, so an earlier event is delivered to nobody.
  await subscribeWithRetry(deps, retry);

  await repairMissedDeliveries(deps);

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
