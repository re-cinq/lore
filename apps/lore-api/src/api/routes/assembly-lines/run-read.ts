import Boom from "@hapi/boom";
import type { ServerRoute } from "@hapi/hapi";
import type { Pool } from "pg";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  graphForRun,
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

/**
 * GET /api/assembly-runs/{id} — one run: the run row, its nodes, and the Station
 * each node dispatches to.
 *
 * Moved from the Floor (#1347). The old comment there said these reads had to
 * live on the Floor because station resolution needs the assembly-line
 * definitions, which were "deliberately absent from lore-api's lean image" — a
 * previous attempt put them here and the container failed to build, because the
 * dependency resolved through workspace hoisting locally and did not exist in
 * Docker. That is a packaging problem, not a boundary: lore-api's Dockerfile now
 * builds `libs/assembly-lines` like the Floor's does, YAMLs included.
 *
 * The Station is the field worth serving. It carries the recipe — the prompt
 * template and the `output.watch` that decides what artifact a run can produce —
 * and an agent node declaring no `station_ref` INHERITS the one named after its
 * line's task type. That inheritance silently ran the planning prompt for every
 * node on the merged planning line; `stationInherited` puts it in the response
 * rather than leaving it to be reconstructed from YAML.
 */

/**
 * A node row joined to what the run's OWN graph says about that node (FR6.38 —
 * station and route were resolved once, at clone time; re-deriving them from the
 * current YAML is how an edited blueprint rewrote a run's history). Graph facts
 * are null when the run predates clones AND its blueprint is gone — the rows are
 * the record of what actually ran, so they still serve.
 */
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
    // The page a HUMAN station's worker acts on, resolved against THIS run's
    // args (FR6.40) — `pr_url` does not exist until the push node opened the PR,
    // so a route resolved any earlier would name a page that is not there yet.
    // Null when the run does not carry every placeholder: a half-built href
    // sends the reader somewhere that does not exist, which is worse than no
    // link.
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
    options: bearerScope("read"),
    handler: async (request) => {
      const pool = getPool();

      enforceTrue(
        runs !== undefined || pool !== null,
        Boom.serverUnavailable,
        "database unavailable",
      );
      const port = runs ?? new PgAssemblyRuns(pool as Pool);
      const line = await port.getById(request.params.id);

      enforceTrue(line !== null, Boom.notFound, "assembly run not found");
      const [rows, graph] = await Promise.all([
        port.listStationRuns(line.id),
        // The run's own clone; a blueprint loaded by name only for rows stamped
        // before clones existed (same rule as the walk and the reaper).
        graphForRun(line, load),
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
