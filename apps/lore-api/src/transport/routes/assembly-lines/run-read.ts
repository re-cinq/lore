import { zodResponse } from "../../http/zod-response.js";
import { z } from "zod";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import type { Request, ServerRoute } from "@hapi/hapi";
import type { Pool } from "pg";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  describeStationRun,
  type RunGraph,
} from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import type {
  AssemblyRunsPort,
  StationRunRecord,
} from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { runsReadingFloor } from "../../../work/floor/floor-backed-runs.js";
import { bearerScope } from "../../http/bearer-scope.js";

// GET /api/assembly-runs/{id} — the run, its nodes, and the Station each dispatches to; moved from the Floor (#1347) once lore-api's Dockerfile started building libs/assembly-lines too. stationInherited surfaces station inheritance in the response rather than leaving it to be reconstructed from YAML.

// The ENRICHED run read (FR6.40a): each node joined to what the run's OWN graph says (FR6.38, cloned when the run started); graph facts are null for a run that predates clones, since the definition it was loaded from by name is deleted.
const RunReadSchema = z.object({
  line: z.record(z.string(), z.unknown()),
  definitionKnown: z.boolean(),
  nodes: z.array(z.record(z.string(), z.unknown())),
});

export function runReadRoute(
  getPool: () => Pool | null,
  runs?: AssemblyRunsPort,
): ServerRoute {
  return {
    method: "GET",
    path: "/api/assembly-runs/{id}",
    options: zodResponse(bearerScope("read"), RunReadSchema, {
      name: "AssemblyRunRead",
      description: "A run joined to the graph it walked",
      errors: [404],
    }),
    handler: (request) => serveRunRead(getPool, runs, request),
  };
}

async function serveRunRead(
  getPool: () => Pool | null,
  runs: AssemblyRunsPort | undefined,
  request: Request,
): Promise<object> {
  const port = resolvePort(getPool(), runs);
  const line = await port.getById(request.params.id);

  enforceTrue(line !== null, apiError(404), "assembly run not found");
  const rows = await port.listStationRuns(line.id);

  return {
    line,
    definitionKnown: Boolean(line.graph),
    nodes: describeNodes(rows, line.graph, line.args),
  };
}

/** One run, enriched: its nodes, its task and the definition it walks — the canonical read the run page is built from. */
/** The injected port, or one built on the pool. The guard pairs the two possibilities because a disjunction cannot narrow `pool` on its own — the cast is proven by having required one of them. */
export function resolvePort(
  pool: Pool | null,
  runs: AssemblyRunsPort | undefined,
): AssemblyRunsPort {
  enforceTrue(
    runs !== undefined || pool !== null,
    apiError(503),
    "database unavailable",
  );

  return runs ?? runsReadingFloor(pool as Pool);
}

/** Each visit joined to the node it visited; a visit whose node has left the graph still describes itself. */
function describeNodes(
  rows: StationRunRecord[],
  graph: RunGraph | null | undefined,
  args: Record<string, unknown>,
) {
  return rows.map((row) =>
    describeStationRun(
      row,
      graph?.nodes.find((n) => n.id === row.nodeId),
      args,
    ),
  );
}
