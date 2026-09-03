import { zodResponse } from "../../../server/plugins/zod-response.js";
import { z } from "zod";
import { apiError } from "../../../server/api-error.js";
import type { ServerRoute } from "@hapi/hapi";
import type { Pool } from "pg";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  resolveRunGraph,
  loadBuiltinAssemblyLines,
  type AssemblyLine,
} from "@re-cinq/lore-assembly-lines";
import {
  resolveRoute,
  type RunGraphNode,
} from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import type {
  AssemblyRunsPort,
  StationRunRecord,
} from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { PgAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-pg.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";

// GET /api/assembly-runs/{id} — the run, its nodes, and the Station each dispatches to; moved from the Floor (#1347) once lore-api's Dockerfile started building libs/assembly-lines too. stationInherited surfaces station inheritance in the response rather than leaving it to be reconstructed from YAML.

// The ENRICHED run read (FR6.40a): each node joined to what the run's OWN graph says (FR6.38, resolved at clone time); graph facts are null only when the run predates clones AND its blueprint is gone.
const RunReadSchema = z.object({
  line: z.record(z.unknown()),
  definitionKnown: z.boolean(),
  nodes: z.array(z.record(z.unknown())),
});

export function describeNode(
  row: StationRunRecord,
  node: RunGraphNode | undefined,
  args: Record<string, unknown> = {},
) {
  return {
    nodeId: row.nodeId,
    iteration: row.iteration,
    outcome: row.outcome,
    agentCrName: row.agentCrName,
    commitSha: row.commitSha,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    type: node?.type ?? null,
    promptRef: node?.prompt_ref ?? null,
    // The page a HUMAN station's worker acts on, resolved against THIS run's args (FR6.40); null when a placeholder (e.g. pr_url) isn't there yet — a half-built href is worse than no link.
    route: resolveRoute(node?.route, args),
    station: node?.station ?? null,
    stationInherited: node?.station_inherited ?? false,
  };
}

export function runReadRoute(
  getPool: () => Pool | null,
  load: () => Promise<Map<string, AssemblyLine>> = loadBuiltinAssemblyLines,
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
    handler: async (request) => {
      const pool = getPool();

      // A disjunction cannot narrow `pool`; the cast below is proven by this guard pairing `runs !== undefined` with `pool !== null`.
      enforceTrue(
        runs !== undefined || pool !== null,
        apiError(503),
        "database unavailable",
      );
      const port = runs ?? new PgAssemblyRuns(pool as Pool);
      const line = await port.getById(request.params.id);

      enforceTrue(line !== null, apiError(404), "assembly run not found");
      const [rows, graph] = await Promise.all([
        port.listStationRuns(line.id),
        // The run's own clone; loaded by name only for rows stamped before clones existed (same rule as the walk and the reaper).
        resolveRunGraph(line, load),
      ]);

      return {
        line,
        definitionKnown: Boolean(graph),
        nodes: rows.map((row) =>
          describeNode(
            row,
            graph?.nodes.find((n) => n.id === row.nodeId),
            line.args,
          ),
        ),
      };
    },
  };
}
