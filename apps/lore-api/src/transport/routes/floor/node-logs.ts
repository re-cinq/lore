// GET /api/assembly-runs/{id}/nodes/{name}/logs — one node's log, whichever engine ran it: the stdout Postgres stored for a node of a run it has, the log the external floor kept for a visit otherwise.
import type { Request, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { floorConfigured } from "@re-cinq/lore-shared/floor/floor-client.js";
import { floorRunReader } from "../../../work/floor/floor-backed-runs.js";
import type { FloorNodeLogs } from "../../../work/floor/floor-records.js";
import type {
  StoredNodeLogs,
  StoredRunHistory,
} from "../../../work/floor/stored-run-history.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";

const NodeLogsSchema = z.object({
  available: z.boolean(),
  logs: z.string().nullable(),
  phase: z.string(),
  podName: z.null(),
  archived: z.boolean(),
  reason: z.literal("no-records").optional(),
});

export type NodeLogsOf = (
  runId: string,
  agentCrName: string,
  tail: number | undefined,
) => Promise<FloorNodeLogs | StoredNodeLogs | null>;

/** Postgres first: a node of a run it has answers with its stored stdout. Any other name is a floor visit's. */
export function nodeLogsReader(
  stored: () => StoredRunHistory | null,
  floorLogsOf: NodeLogsOf = floorNodeLogs,
): NodeLogsOf {
  return async (runId, agentCrName, tail) =>
    (await stored()?.nodeLogs(runId, agentCrName, tail)) ??
    floorLogsOf(runId, agentCrName, tail);
}

const floorNodeLogs = (
  runId: string,
  agentCrName: string,
  tail: number | undefined,
): Promise<FloorNodeLogs | null> =>
  floorConfigured()
    ? floorRunReader().nodeLogs(runId, agentCrName, tail)
    : Promise.resolve(null);

export function nodeLogsRoute(logsOf: NodeLogsOf): ServerRoute {
  return {
    method: "GET",
    path: "/api/assembly-runs/{id}/nodes/{name}/logs",
    options: zodResponse(bearerScope("read"), NodeLogsSchema, {
      name: "NodeLogs",
      description:
        "One node's log: stored stdout for a node of a run Postgres has, the floor's log for a visit named floor-<visit id>; 404 for a name of no node of this run",
      errors: [404],
    }),
    handler: (request: Request, h: ResponseToolkit) =>
      serveNodeLogs(logsOf, request, h),
  };
}

async function serveNodeLogs(
  logsOf: NodeLogsOf,
  request: Request,
  h: ResponseToolkit,
) {
  const logs = await logsOf(
    request.params.id as string,
    request.params.name as string,
    tailOf(request.query.tail),
  );

  enforceTrue(logs !== null, apiError(404), "node not found for this run");

  return h.response(logs);
}

function tailOf(value: unknown): number | undefined {
  const tail = Number(value);

  return Number.isInteger(tail) && tail > 0 ? tail : undefined;
}
