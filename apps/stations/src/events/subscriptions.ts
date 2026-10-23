// Subscriptions are derived from the manifests, so a station declaring an event trigger is subscribed by that declaration alone — no drift between subscription set and registry.

import type { EventSubscription } from "@re-cinq/lore-shared/project/events/event-deliveries-port.js";
import { STATIONS } from "../work/registry.js";
import { eventSubscriptionsOf } from "../work/lib/station.js";
import {
  floorConfigured,
  type FloorEnv,
} from "@re-cinq/lore-shared/floor/floor-client.js";
import { FLOOR_PLAN_EVENTS } from "./floor-plan-handlers.js";
import { FLOOR_SPEC_TICKETS_EVENTS } from "./floor-spec-tickets-handlers.js";
import { FLOOR_REVIEW_EVENTS } from "./floor-review-handlers.js";
import { LOOP_MERGE_EVENTS } from "./loop-merge-handlers.js";
import { LOOP_UPKEEP_EVENTS } from "./loop-upkeep-handlers.js";
import { REPO_EVENTS } from "./repo-handlers.js";

// One subscriber per ROLE not per replica — two stations pods share one backlog, same as two Floors.
export const STATIONS_SUBSCRIBER = "stations";

/** The repository and floor events on the bus's visibility budget, then every event a sweep declares on its trigger's own. */
export function stationSubscriptions(
  env: FloorEnv = process.env,
): EventSubscription[] {
  const plain = [...REPO_EVENTS, ...floorEvents(env)].map((eventName) => ({
    eventName,
  }));
  const sweeps = Object.values(STATIONS).flatMap((mod) =>
    eventSubscriptionsOf(mod.manifest),
  );
  const byName = new Map<string, EventSubscription>(
    [...plain, ...sweeps].map((s) => [s.eventName, s]),
  );

  return [...byName.values()];
}

/** A deployment with no floor starts no review and has no plan run to answer, so it claims none of the events that would. */
function floorEvents(env: FloorEnv): readonly string[] {
  return floorConfigured(env)
    ? [
        ...FLOOR_REVIEW_EVENTS,
        ...FLOOR_PLAN_EVENTS,
        ...LOOP_MERGE_EVENTS,
        ...LOOP_UPKEEP_EVENTS,
        ...FLOOR_SPEC_TICKETS_EVENTS,
      ]
    : [];
}
