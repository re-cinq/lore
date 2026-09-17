/** HTTP delivery routes: multiple subscribers each consume their own copy, disjoint batches via FOR UPDATE SKIP LOCKED. */

import type { Lifecycle, ServerRoute } from "@hapi/hapi";
import type { EventDeliveriesPort } from "@re-cinq/lore-shared/project/events/event-deliveries-port.js";
import {
  DeadBody,
  FailBody,
  PruneBody,
} from "@re-cinq/lore-shared/project/events/event-deliveries-wire.js";
import {
  DeadLetterBody,
  DeliveryClaimBody,
  OrphanBody,
  ReconcileBody,
  SubscribeBody,
} from "@re-cinq/lore-shared/project/events/event-deliveries-wire.js";
import { rawBody } from "@re-cinq/lore-shared/http/raw-body.js";
import { parseBody } from "@re-cinq/lore-shared/http/json-body.js";
import { enforceBearer } from "@re-cinq/lore-shared/http/bearer.js";

export interface EventDeliveryRoutesDeps {
  /** Thunk: routes built before pool exists, resolving here would couple buildServer to DB. */
  deliveries: () => EventDeliveriesPort;
  bearerToken?: string;
}

const NO_BODY = { auth: false, payload: { parse: false } } as const;

export function eventDeliveryRoutes(
  deps: EventDeliveryRoutesDeps,
): ServerRoute[] {
  return [
    subscribeRoute(deps),
    claimRoute(deps),
    ackRoute(deps),
    failRoute(deps),
    deadRoute(deps),
    reapRoute(deps),
    pruneRoute(deps),
    reconcileRoute(deps),
    orphanedRoute(deps),
    deadLetteredRoute(deps),
  ];
}

/** Records which event names a subscriber wants a delivery row for. Called once at boot by the Floor (`outbound/event-store.ts`) and by stations (`events/loop-boot.ts`); a name nobody subscribed to produces no deliveries. */
function subscribeRoute(deps: EventDeliveryRoutesDeps): ServerRoute {
  return {
    method: "POST",
    path: "/api/subscriptions",
    options: NO_BODY,
    handler: async (request, h) => {
      guard(deps, request.headers);
      const { subscriber, subscriptions } = parseBody(
        rawBody(request),
        SubscribeBody,
        "subscribe",
      );

      await deps.deliveries().subscribe(subscriber, subscriptions);

      return h.response().code(204);
    },
  };
}

/** Hands out the next batch of pending deliveries. Called on every poll tick of the Floor main loop and the stations loop. */
function claimRoute(deps: EventDeliveryRoutesDeps): ServerRoute {
  return {
    method: "POST",
    path: "/api/deliveries/claim",
    options: NO_BODY,
    handler: claimHandler(deps),
  };
}

// Hands a subscriber its next batch. The exclusion list is READ at claim time and holds a busy serial family back, so rows for a family already in flight stay pending rather than being handed out twice.
function claimHandler(deps: EventDeliveryRoutesDeps): Lifecycle.Method {
  return async (request, h) => {
    guard(deps, request.headers);
    const { subscriber, limit, excludeEventNames } = parseBody(
      rawBody(request),
      DeliveryClaimBody,
      "claim",
    );
    const deliveries = await deps
      .deliveries()
      .claim(subscriber, limit, excludeEventNames ?? []);

    return h.response({ deliveries }).code(200);
  };
}

/** Settles one delivery as handled. Called by the Floor and stations loops after their handler returns. */
function ackRoute(deps: EventDeliveryRoutesDeps): ServerRoute {
  return {
    method: "POST",
    path: "/api/deliveries/{id}/ack",
    options: NO_BODY,
    handler: async (request, h) => {
      guard(deps, request.headers);
      await deps.deliveries().markDone(request.params.id);

      return h.response().code(204);
    },
  };
}

/** Settles one delivery as retryable, re-hidden for `backoffSeconds`. Called by the Floor and stations loops when a handler throws and the subscriber still has retries left. */
function failRoute(deps: EventDeliveryRoutesDeps): ServerRoute {
  return {
    method: "POST",
    path: "/api/deliveries/{id}/fail",
    options: NO_BODY,
    handler: async (request, h) => {
      guard(deps, request.headers);
      const { error, backoffSeconds } = parseBody(
        rawBody(request),
        FailBody,
        "fail",
      );

      await deps
        .deliveries()
        .markFailed(request.params.id, error, backoffSeconds);

      return h.response().code(204);
    },
  };
}

/** Settles one delivery as permanently failed. Called by the Floor and stations loops once a handler has exhausted the subscriber's retry budget. */
function deadRoute(deps: EventDeliveryRoutesDeps): ServerRoute {
  return {
    // Own route, not a fail flag: subscriber judges delivery budget, not the service.
    method: "POST",
    path: "/api/deliveries/{id}/dead",
    options: NO_BODY,
    handler: async (request, h) => {
      guard(deps, request.headers);
      const { error } = parseBody(rawBody(request), DeadBody, "dead");

      await deps.deliveries().markDead(request.params.id, error);

      return h.response().code(204);
    },
  };
}

/** Returns claimed-but-unsettled deliveries past their visibility timeout to pending. Called by the Floor's reaper tick (`events/main-loop/reaper.ts`). */
function reapRoute(deps: EventDeliveryRoutesDeps): ServerRoute {
  return {
    // No body: each row has its own visibility timeout, no global one for caller.
    method: "POST",
    path: "/api/deliveries/reap",
    options: NO_BODY,
    handler: async (request, h) => {
      guard(deps, request.headers);

      return h
        .response({ reaped: await deps.deliveries().reapStuck() })
        .code(200);
    },
  };
}

/** Deletes settled deliveries older than `olderThanDays` — the table's only shrink path. Called by the Floor's daily cron handler with a 7-day window. */
function pruneRoute(deps: EventDeliveryRoutesDeps): ServerRoute {
  return {
    method: "POST",
    path: "/api/deliveries/prune",
    options: NO_BODY,
    handler: async (request, h) => {
      guard(deps, request.headers);
      const { olderThanDays } = parseBody(rawBody(request), PruneBody, "prune");

      return h
        .response({
          pruned: await deps.deliveries().pruneHandled(olderThanDays),
        })
        .code(200);
    },
  };
}

/** Repairs deliveries a crashed subscriber left claimed. Called at boot by the Floor (`index.ts`) and stations (`events/loop-boot.ts`), before either starts claiming again. */
function reconcileRoute(deps: EventDeliveryRoutesDeps): ServerRoute {
  return {
    method: "POST",
    path: "/api/deliveries/reconcile",
    options: NO_BODY,
    handler: reconcileHandler(deps),
  };
}

// The safety net for deliveries whose subscriber never acked. Bounded by a window rather than sweeping everything: a delivery still inside its window may simply be slow.
function reconcileHandler(deps: EventDeliveryRoutesDeps): Lifecycle.Method {
  return async (request, h) => {
    guard(deps, request.headers);
    const { withinMinutes } = parseBody(
      rawBody(request),
      ReconcileBody,
      "reconcile",
    );
    const reconciled = await deps
      .deliveries()
      .reconcileDeliveries(withinMinutes);

    return h.response({ reconciled }).code(200);
  };
}

/** Reports events that produced no delivery at all — a subscription gap, not a handler failure. Read-only; called by the Floor's cron report. */
function orphanedRoute(deps: EventDeliveryRoutesDeps): ServerRoute {
  return {
    method: "POST",
    path: "/api/deliveries/orphaned",
    options: NO_BODY,
    handler: async (request, h) => {
      guard(deps, request.headers);
      const { withinMinutes } = parseBody(
        rawBody(request),
        OrphanBody,
        "orphaned",
      );

      return h
        .response({
          orphaned: await deps.deliveries().orphanedEvents(withinMinutes),
        })
        .code(200);
    },
  };
}

/** The sibling of `orphaned` for the other silent failure: deliveries a handler ran out of retries on. Read-only; called by the Floor's cron report. */
function deadLetteredRoute(deps: EventDeliveryRoutesDeps): ServerRoute {
  return {
    method: "POST",
    path: "/api/deliveries/dead-lettered",
    options: NO_BODY,
    handler: async (request, h) => {
      guard(deps, request.headers);
      const { withinMinutes } = parseBody(
        rawBody(request),
        DeadLetterBody,
        "dead-lettered",
      );

      return h
        .response({ dead: await deps.deliveries().deadLettered(withinMinutes) })
        .code(200);
    },
  };
}

/** Every route is bearer-guarded with the router's own token; the check is the first line of each handler so an unauthenticated call never reaches a query. */
function guard(
  deps: EventDeliveryRoutesDeps,
  headers: Record<string, unknown>,
): void {
  enforceBearer(headers, deps.bearerToken);
}
