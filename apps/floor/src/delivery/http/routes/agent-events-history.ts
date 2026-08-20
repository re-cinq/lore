/**
 * GET /api/agent-events/{assemblyRunId}?after=&limit= (FR3.1) — the plain REST
 * read of a finished run, and the fallback for clients without EventSource.
 * A thin clamped wrapper over the same `listSince` the SSE catch-up uses, so
 * both surfaces share one scoping rule: rows are selected by assembly line AND
 * cursor, never by cursor alone.
 *
 * Deliberate asymmetry with the turn routes: they respond `{turns, hasMore}`
 * (#1310) because the web-ui turn walks end on the flag; this route's `{events}`
 * body still ends its client's paging by page length against DEFAULT_LIMIT —
 * the same latent drift class, tracked in #1397.
 */

import { agentRunEvents } from "../../../kernel/queues.js";
import type { ServerRoute } from "@hapi/hapi";
import type { AgentRunEventRow } from "@re-cinq/lore-shared";

export const DEFAULT_LIMIT = 1000;
export const MAX_LIMIT = 5000;

/** LORE_INGEST_TOKEN is shared with the web-ui, so a signed-in user can reach
 *  this directly — an unbounded limit would be an unbounded read. */
export function parseLimit(raw: unknown): number {
  const n = Number(raw);

  return Number.isInteger(n) && n > 0 ? Math.min(n, MAX_LIMIT) : DEFAULT_LIMIT;
}

export function parseAfter(raw: unknown): string {
  return typeof raw === "string" && /^\d+$/.test(raw) ? raw : "0";
}

export function agentEventsHistoryRoute(events?: {
  listSince: (
    assemblyLineId: string,
    afterId: string,
    limit: number,
  ) => Promise<AgentRunEventRow[]>;
}): ServerRoute {
  return {
    method: "GET",
    path: "/api/agent-events/{assemblyRunId}",
    options: { auth: "ingest-token" },
    handler: async (request, h) => {
      const rows = await (events ?? agentRunEvents()).listSince(
        request.params.assemblyRunId,
        parseAfter(request.query.after),
        parseLimit(request.query.limit),
      );

      return h.response({ events: rows }).code(200);
    },
  };
}
