/**
 * GET /api/agent-turns/{assemblyLineId}?after=&limit= — the read half of the
 * turn-level transcript store (specs/turn-level-transcript-store FR4). Without
 * it the table would be a second write-only archive, which is exactly the gap
 * the feature exists to close.
 *
 * Deliberately a plain cursor-paged REST read and not an SSE stream: turns
 * answer post-mortem questions after the fact, and the live view is already
 * served by the run-event projection (ADR-037).
 *
 * Clamping is shared with the event history route — same rule, same reason:
 * LORE_INGEST_TOKEN is shared with the web-ui, so an unbounded limit would be
 * an unbounded read.
 */

import { agentRunTurns } from "../../../kernel/queues.js";
import { parseAfter, parseLimit } from "./agent-events-history.js";
import type { ServerRoute } from "@hapi/hapi";
import type { AgentRunTurnRow } from "@re-cinq/lore-shared";

export function agentTurnsHistoryRoute(turns?: {
  listByLine: (
    assemblyLineId: string,
    afterId: string,
    limit: number,
  ) => Promise<AgentRunTurnRow[]>;
}): ServerRoute {
  return {
    method: "GET",
    path: "/api/agent-turns/{assemblyLineId}",
    options: { auth: "ingest-token" },
    handler: async (request, h) => {
      const rows = await (turns ?? agentRunTurns()).listByLine(
        request.params.assemblyLineId,
        parseAfter(request.query.after),
        parseLimit(request.query.limit),
      );

      return h.response({ turns: rows }).code(200);
    },
  };
}
