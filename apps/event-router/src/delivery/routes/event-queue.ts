/**
 * The consume side of `pipeline.events`, over HTTP (ADR-044).
 *
 * The router owns the table; the Floor drains it. These are the six calls the
 * drain loop and its reaper make, and nothing more — no route here lets a caller
 * write an event, because producing and draining are different privileges even
 * when one process happens to do both.
 *
 * The atomicity does not live here. `claimBatch` is one `FOR UPDATE SKIP LOCKED`
 * statement server-side, so this only wraps it — two drainers calling at once
 * still get disjoint batches, exactly as two in-process callers did.
 */

import { z } from "zod";
import type { ServerRoute } from "@hapi/hapi";
import type { EventQueueRepository } from "@re-cinq/lore-shared/project/events/event-queue-port.js";
import { rawBody } from "@re-cinq/lore-shared/http/raw-body.js";
import { parseBody } from "@re-cinq/lore-shared/http/json-body.js";
import { enforceBearer } from "@re-cinq/lore-shared/http/bearer.js";

const Claim = z.object({
  limit: z.number().int().positive(),
  excludeEventNames: z.array(z.string()).optional(),
});
const Failure = z.object({
  error: z.string(),
  backoffSeconds: z.number().int().nonnegative(),
});
const Dead = z.object({ error: z.string() });
const Reap = z.object({ timeoutSeconds: z.number().int().nonnegative() });
const Prune = z.object({ olderThanDays: z.number().int().nonnegative() });

export interface EventQueueRoutesDeps {
  /** A THUNK: routes are built before the pool exists, and resolving the queue
   *  here would make `buildServer` demand a database just to describe itself. */
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
          Claim,
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
          Failure,
          "failure",
        );

        await deps.queue().markFailed(request.params.id, error, backoffSeconds);

        return h.response().code(204);
      },
    },
    {
      // Separate from `fail` on purpose: whether an event has run out of
      // attempts is the DRAINER's judgement, and folding both into one endpoint
      // would move that decision here, where the retry budget is not known.
      method: "POST",
      path: "/api/events/{id}/dead",
      options: { auth: false, payload: { parse: false } },
      handler: async (request, h) => {
        guard(request.headers);
        const { error } = parseBody(rawBody(request), Dead, "dead-letter");

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
        const { timeoutSeconds } = parseBody(rawBody(request), Reap, "reap");

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
        const { olderThanDays } = parseBody(rawBody(request), Prune, "prune");

        return h
          .response({ pruned: await deps.queue().pruneHandled(olderThanDays) })
          .code(200);
      },
    },
  ];
}
