// GET /api/assembly-runs/{id}/turns — the untruncated transcript of a run on the external floor, paged the way the Floor pages its own `/api/agent-turns/{id}` so the run page reads either without knowing which engine ran it.
import type { Request, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import type { AgentRunTurnRow } from "@re-cinq/lore-shared/project/agent-run-turns/agent-run-turns-port.js";
import { floorConfigured } from "@re-cinq/lore-shared/floor/floor-client.js";
import { floorRunReader } from "../../../work/floor/floor-backed-runs.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

const TurnPageSchema = z.object({
  turns: z.array(z.unknown()),
  hasMore: z.boolean(),
});

export type TurnsOf = (runId: string) => Promise<AgentRunTurnRow[]>;

const floorTurns: TurnsOf = (runId) =>
  floorConfigured() ? floorRunReader().turns(runId) : Promise.resolve([]);

export function floorRunTurnsRoute(turnsOf: TurnsOf = floorTurns): ServerRoute {
  return {
    method: "GET",
    path: "/api/assembly-runs/{id}/turns",
    options: zodResponse(bearerScope("read"), TurnPageSchema, {
      name: "FloorRunTurns",
      description:
        "One page of the turns of a run on the external floor, oldest first; empty for a run the floor does not have",
    }),
    handler: async (request: Request, h: ResponseToolkit) =>
      h.response(
        turnPage(await turnsOf(request.params.id as string), request.query),
      ),
  };
}

/** The turns after the cursor, one page of them, and whether more remain. */
export function turnPage(
  turns: AgentRunTurnRow[],
  query: { after?: unknown; limit?: unknown },
): { turns: AgentRunTurnRow[]; hasMore: boolean } {
  const after = Number(query.after) || 0;
  const limit = Math.min(Number(query.limit) || DEFAULT_LIMIT, MAX_LIMIT);
  const remaining = turns.filter((turn) => Number(turn.id) > after);

  return {
    turns: remaining.slice(0, limit),
    hasMore: remaining.length > limit,
  };
}
