/** GET /api/agent-turns/task/{taskId}?after=&limit= — the only path to turns uncorrelated to any assembly-line node (specs/turn-level-transcript-store FR4, #1148). */

import { pipeline } from "../../../kernel/queues.js";
import { parseAfter, parseLimit } from "./agent-events-history.js";
import { PAGE_LOOKAHEAD, pageWithLookahead } from "./agent-turns-history.js";
import type { ServerRoute } from "@hapi/hapi";
import type { AgentRunTurnRow } from "@re-cinq/lore-shared";

export function agentTurnsByTaskRoute(turns?: {
  listByTask: (
    taskId: string,
    afterId: string,
    limit: number,
  ) => Promise<AgentRunTurnRow[]>;
}): ServerRoute {
  return {
    method: "GET",
    path: "/api/agent-turns/task/{taskId}",
    options: { auth: "ingest-token" },
    handler: async (request, h) => {
      const limit = parseLimit(request.query.limit);
      const rows = await (turns ?? pipeline().agentRunTurns).listByTask(
        request.params.taskId,
        parseAfter(request.query.after),
        limit + PAGE_LOOKAHEAD,
      );

      return h.response(pageWithLookahead(rows, limit)).code(200);
    },
  };
}
