// GET /api/assembly-runs/{id}/nodes/{name}/logs — the log the external floor kept for one visit of a run, in the shape the run page reads a Lore pod's logs in, so the node log panel reads either without knowing which engine ran it.
import type { Request, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { floorConfigured } from "@re-cinq/lore-shared/floor/floor-client.js";
import { floorRunReader } from "../../../work/floor/floor-backed-runs.js";
import type { FloorNodeLogs } from "../../../work/floor/floor-records.js";
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
) => Promise<FloorNodeLogs | null>;

const floorNodeLogs: NodeLogsOf = (runId, agentCrName, tail) =>
  floorConfigured()
    ? floorRunReader().nodeLogs(runId, agentCrName, tail)
    : Promise.resolve(null);

export function floorNodeLogsRoute(
  logsOf: NodeLogsOf = floorNodeLogs,
): ServerRoute {
  return {
    method: "GET",
    path: "/api/assembly-runs/{id}/nodes/{name}/logs",
    options: zodResponse(bearerScope("read"), NodeLogsSchema, {
      name: "FloorNodeLogs",
      description:
        "The log the external floor kept for one visit of a run, named floor-<visit id>; 404 for a name of no visit of this run",
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
