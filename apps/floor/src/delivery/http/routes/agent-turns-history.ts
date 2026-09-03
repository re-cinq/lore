/** GET /api/agent-turns/{assemblyRunId}?after=&limit= — the read half of the turn-level transcript store (specs/turn-level-transcript-store FR4); a plain cursor-paged REST read, not SSE, since the live view is already served by ADR-037's run-event projection. Limit-clamping shared with the event history route, since LORE_INGEST_TOKEN is shared with the web-ui. */

import { pipeline } from "../../../kernel/queues.js";
import { parseAfter, parseLimit } from "./agent-events-history.js";
import type { ServerRoute } from "@hapi/hapi";
import type { AgentRunTurnRow } from "@re-cinq/lore-shared";

/** Both turn routes read one row past the requested page so the explicit `hasMore` flag lets the web-ui stop on the server's answer instead of comparing page length to a client-side MAX_LIMIT copy (#1310). */
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
