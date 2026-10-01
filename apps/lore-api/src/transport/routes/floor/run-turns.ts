// GET /api/assembly-runs/{id}/turns — the untruncated transcript of a run, whichever engine ran it: the stored turns of a run Postgres has, the external floor's for any other.
import type { Request, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import type { AgentRunTurnRow } from "@re-cinq/lore-shared/project/agent-run-turns/agent-run-turns-port.js";
import { floorConfigured } from "@re-cinq/lore-shared/floor/floor-client.js";
import { floorRunReader } from "../../../work/floor/floor-backed-runs.js";
import type { StoredRunHistory } from "../../../work/floor/stored-run-history.js";
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

interface TurnPage {
  turns: AgentRunTurnRow[];
  hasMore: boolean;
}

type PageQuery = { after?: unknown; limit?: unknown };

export type TurnPageOf = (runId: string, query: PageQuery) => Promise<TurnPage>;

/** Postgres first: a run it has is paged in the database, read one row past the page so `hasMore` is the server's answer. Any other run is the floor's. */
export function turnPageReader(
  stored: () => StoredRunHistory | null,
  floorTurnsOf: TurnsOf = floorTurns,
): TurnPageOf {
  return async (runId, query) => {
    const limit = limitOf(query.limit);
    const rows = await stored()?.turns(runId, cursorOf(query.after), limit + 1);

    return rows
      ? { turns: rows.slice(0, limit), hasMore: rows.length > limit }
      : turnPage(await floorTurnsOf(runId), query);
  };
}

export function runTurnsRoute(pageOf: TurnPageOf): ServerRoute {
  return {
    method: "GET",
    path: "/api/assembly-runs/{id}/turns",
    options: zodResponse(bearerScope("read"), TurnPageSchema, {
      name: "RunTurns",
      description:
        "One page of a run's turns, oldest first; empty for a run neither Postgres nor the floor has",
    }),
    handler: async (request: Request, h: ResponseToolkit) =>
      h.response(await pageOf(request.params.id as string, request.query)),
  };
}

// A limit that is no positive whole number reads as the default: it reaches Postgres as a LIMIT, which refuses a negative or fractional one.
function limitOf(value: unknown): number {
  const asked = Number(value);

  return Number.isInteger(asked) && asked > 0
    ? Math.min(asked, MAX_LIMIT)
    : DEFAULT_LIMIT;
}

function cursorOf(value: unknown): string {
  return typeof value === "string" && /^\d+$/.test(value) ? value : "0";
}

/** The turns after the cursor, one page of them, and whether more remain. */
export function turnPage(turns: AgentRunTurnRow[], query: PageQuery): TurnPage {
  const after = Number(query.after) || 0;
  const limit = limitOf(query.limit);
  const remaining = turns.filter((turn) => Number(turn.id) > after);

  return {
    turns: remaining.slice(0, limit),
    hasMore: remaining.length > limit,
  };
}
