/** Consume side of pipeline.events (ADR-044): router owns table, Floor drains; no writes here (different privilege). */

import type { ServerRoute } from "@hapi/hapi";
import type { EventQueueRepository } from "@re-cinq/lore-shared/project/events/event-queue-port.js";
import {
  ClaimBody,
  DeadBody,
  FailBody,
  PruneBody,
  ReapBody,
} from "@re-cinq/lore-shared/project/events/event-queue-wire.js";
import { rawBody } from "@re-cinq/lore-shared/http/raw-body.js";
import { parseBody } from "@re-cinq/lore-shared/http/json-body.js";
import { enforceBearer } from "@re-cinq/lore-shared/http/bearer.js";

export interface EventQueueRoutesDeps {
  /** Thunk: routes built before pool, resolving would couple buildServer to DB. */
  queue: () => EventQueueRepository;
  bearerToken?: string;
}

export function eventQueueRoutes(deps: EventQueueRoutesDeps): ServerRoute[] {
  const guard = (headers: Record<string, unknown>): void =>
    enforceBearer(headers, deps.bearerToken);

  return [
    {
      method: "POST",
      path: "/api/events/claim",
      options: { auth: false, payload: { parse: false } },
      handler: async (request, h) => {
        guard(request.headers);
        const { limit, excludeEventNames } = parseBody(
          rawBody(request),
          ClaimBody,
          "claim",
        );

        return h
          .response({
            events: await deps
              .queue()
              .claimBatch(limit, excludeEventNames ?? []),
          })
          .code(200);
      },
    },
    {
      method: "POST",
      path: "/api/events/{id}/ack",
      options: { auth: false },
      handler: async (request, h) => {
        guard(request.headers);
        await deps.queue().markDone(request.params.id);

        return h.response().code(204);
      },
    },
    {
      method: "POST",
      path: "/api/events/{id}/fail",
      options: { auth: false, payload: { parse: false } },
      handler: async (request, h) => {
        guard(request.headers);
        const { error, backoffSeconds } = parseBody(
          rawBody(request),
          FailBody,
          "failure",
        );

        await deps.queue().markFailed(request.params.id, error, backoffSeconds);

        return h.response().code(204);
      },
    },
    {
      // Separate from fail: drainer judges budget, not the service.
      method: "POST",
      path: "/api/events/{id}/dead",
      options: { auth: false, payload: { parse: false } },
      handler: async (request, h) => {
        guard(request.headers);
        const { error } = parseBody(rawBody(request), DeadBody, "dead-letter");

        await deps.queue().markDead(request.params.id, error);

        return h.response().code(204);
      },
    },
    {
      method: "POST",
      path: "/api/events/reap",
      options: { auth: false, payload: { parse: false } },
      handler: async (request, h) => {
        guard(request.headers);
        const { timeoutSeconds } = parseBody(
          rawBody(request),
          ReapBody,
          "reap",
        );

        return h
          .response({ reaped: await deps.queue().reapStuck(timeoutSeconds) })
          .code(200);
      },
    },
    {
      method: "POST",
      path: "/api/events/prune",
      options: { auth: false, payload: { parse: false } },
      handler: async (request, h) => {
        guard(request.headers);
        const { olderThanDays } = parseBody(
          rawBody(request),
          PruneBody,
          "prune",
        );

        return h
          .response({ pruned: await deps.queue().pruneHandled(olderThanDays) })
          .code(200);
      },
    },
  ];
}
