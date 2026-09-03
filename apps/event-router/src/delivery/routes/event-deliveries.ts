/** HTTP delivery routes: multiple subscribers each consume their own copy, disjoint batches via FOR UPDATE SKIP LOCKED. */

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
  /** Thunk: routes built before pool exists, resolving here would couple buildServer to DB. */
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
            // Exclusion is READ: claim time holds busy serial family so waiting rows stay pending.
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
      // Own route, not a fail flag: subscriber judges delivery budget, not the service.
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
      // No body: each row has its own visibility timeout, no global one for caller.
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
