/**
 * GET /api/agent-turns/{assemblyRunId}?after=&limit= — the read half of the
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

import { pipeline } from "../../../kernel/queues.js";
import { parseAfter, parseLimit } from "./agent-events-history.js";
import type { ServerRoute } from "@hapi/hapi";
import type { AgentRunTurnRow } from "@re-cinq/lore-shared";

/**
 * Both turn routes read one row past the requested page: an exactly-full page
 * alone cannot say whether rows follow, and the explicit `hasMore` flag is
 * what lets the web-ui walks end on the server's answer instead of comparing
 * page length against a client-side copy of MAX_LIMIT (#1310). Sound because
 * the cursor is exclusive (`id > after`) over a stable `ORDER BY id ASC`.
 */
export const PAGE_LOOKAHEAD = 1;

export function pageWithLookahead(rows: AgentRunTurnRow[], limit: number) {
  return { turns: rows.slice(0, limit), hasMore: rows.length > limit };
}

export function agentTurnsHistoryRoute(turns?: {
  listByLine: (
    assemblyLineId: string,
    afterId: string,
    limit: number,
  ) => Promise<AgentRunTurnRow[]>;
}): ServerRoute {
  return {
    method: "GET",
    path: "/api/agent-turns/{assemblyRunId}",
    options: { auth: "ingest-token" },
    handler: async (request, h) => {
      const limit = parseLimit(request.query.limit);
      const rows = await (turns ?? pipeline().agentRunTurns).listByLine(
        request.params.assemblyRunId,
        parseAfter(request.query.after),
        limit + PAGE_LOOKAHEAD,
      );

      return h.response(pageWithLookahead(rows, limit)).code(200);
    },
  };
}
