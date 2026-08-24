/**
 * The delivery side of the bus, over HTTP.
 *
 * The queue's routes let ONE drainer consume `pipeline.events`. These let any
 * number of subscribers consume their own copy: a subscriber registers what it
 * wants, then claims, acks, fails and dead-letters only its own deliveries.
 *
 * As with the queue routes, no route here writes an event — producing and
 * consuming are different privileges even when one process does both — and the
 * atomicity is not here either: `claim` is one FOR UPDATE SKIP LOCKED statement
 * server-side, so two replicas of a subscriber still get disjoint batches.
 */

import type { ServerRoute } from "@hapi/hapi";
import type { EventDeliveriesPort } from "@re-cinq/lore-shared/project/events/event-deliveries-port.js";
import {
  DeadBody,
  FailBody,
  PruneBody,
} from "@re-cinq/lore-shared/project/events/event-queue-wire.js";
import {
  DeliveryClaimBody,
  OrphanBody,
  ReconcileBody,
  SubscribeBody,
} from "@re-cinq/lore-shared/project/events/event-deliveries-wire.js";
import { rawBody } from "@re-cinq/lore-shared/http/raw-body.js";
import { parseBody } from "@re-cinq/lore-shared/http/json-body.js";
import { enforceBearer } from "@re-cinq/lore-shared/http/bearer.js";

export interface EventDeliveryRoutesDeps {
  /** A THUNK, for the reason the queue routes give: routes are built before the
   *  pool exists, and resolving here would make `buildServer` demand a database
   *  just to describe itself. */
  deliveries: () => EventDeliveriesPort;
  bearerToken?: string;
}

const NO_BODY = { auth: false, payload: { parse: false } } as const;

export function eventDeliveryRoutes(
  deps: EventDeliveryRoutesDeps,
): ServerRoute[] {
  const guard = (headers: Record<string, unknown>): void =>
    enforceBearer(headers, deps.bearerToken);

  return [
    {
      method: "POST",
      path: "/api/subscriptions",
      options: NO_BODY,
      handler: async (request, h) => {
        guard(request.headers);
        const { subscriber, subscriptions } = parseBody(
          rawBody(request),
          SubscribeBody,
          "subscribe",
        );

        await deps.deliveries().subscribe(subscriber, subscriptions);

        return h.response().code(204);
      },
    },
    {
      method: "POST",
      path: "/api/deliveries/claim",
      options: NO_BODY,
      handler: async (request, h) => {
        guard(request.headers);
        const { subscriber, limit, excludeEventNames } = parseBody(
          rawBody(request),
          DeliveryClaimBody,
          "claim",
        );

        return h
          .response({
            // The exclusion is READ, not just parsed: a busy serial family is
            // held back at claim time so its waiting rows stay `pending`.
            // Dropping it here handed the caller the very rows it asked to be
            // spared, which is the concurrent execution the exclusion prevents.
            deliveries: await deps
              .deliveries()
              .claim(subscriber, limit, excludeEventNames ?? []),
          })
          .code(200);
      },
    },
    {
      method: "POST",
      path: "/api/deliveries/{id}/ack",
      options: NO_BODY,
      handler: async (request, h) => {
        guard(request.headers);
        await deps.deliveries().markDone(request.params.id);

        return h.response().code(204);
      },
    },
    {
      method: "POST",
      path: "/api/deliveries/{id}/fail",
      options: NO_BODY,
      handler: async (request, h) => {
        guard(request.headers);
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
    },
    {
      // Its own route, not a flag on fail: whether a delivery has run out of
      // attempts is the SUBSCRIBER's judgement, and folding the two together
      // would move that decision to a service that does not know its budget.
      method: "POST",
      path: "/api/deliveries/{id}/dead",
      options: NO_BODY,
      handler: async (request, h) => {
        guard(request.headers);
        const { error } = parseBody(rawBody(request), DeadBody, "dead");

        await deps.deliveries().markDead(request.params.id, error);

        return h.response().code(204);
      },
    },
    {
      // No body: each row is judged against its OWN visibility timeout, so there
      // is no global one for a caller to pass.
      method: "POST",
      path: "/api/deliveries/reap",
      options: NO_BODY,
      handler: async (request, h) => {
        guard(request.headers);

        return h
          .response({ reaped: await deps.deliveries().reapStuck() })
          .code(200);
      },
    },
    {
      method: "POST",
      path: "/api/deliveries/prune",
      options: NO_BODY,
      handler: async (request, h) => {
        guard(request.headers);
        const { olderThanDays } = parseBody(
          rawBody(request),
          PruneBody,
          "prune",
        );

        return h
          .response({
            pruned: await deps.deliveries().pruneHandled(olderThanDays),
          })
          .code(200);
      },
    },
    {
      method: "POST",
      path: "/api/deliveries/reconcile",
      options: NO_BODY,
      handler: async (request, h) => {
        guard(request.headers);
        const { withinMinutes } = parseBody(
          rawBody(request),
          ReconcileBody,
          "reconcile",
        );

        return h
          .response({
            reconciled: await deps
              .deliveries()
              .reconcileDeliveries(withinMinutes),
          })
          .code(200);
      },
    },
    {
      method: "POST",
      path: "/api/deliveries/orphaned",
      options: NO_BODY,
      handler: async (request, h) => {
        guard(request.headers);
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
    },
  ];
}
