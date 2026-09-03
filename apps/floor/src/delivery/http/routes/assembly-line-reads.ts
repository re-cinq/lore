// Read access to assembly lines over HTTP. Lives on the FLOOR, not lore-api, because Station resolution needs the assembly-line definitions baked into the Floor's image (they fail to build in lore-api's lean container).

import { apiError } from "../api-error.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { ServerRoute } from "@hapi/hapi";
import {
  loadBuiltinAssemblyLines,
  resolveNodeStation,
  type AssemblyLine,
} from "@re-cinq/lore-assembly-lines";
import {
  resolveRoute,
  type RunGraphNode,
} from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import { resolveRunGraph } from "@re-cinq/lore-assembly-lines";
import { pipeline } from "../../../kernel/queues.js";

interface NodeRow {
  nodeId: string;
  iteration: number;
  outcome: string | null;
  agentCrName: string | null;
  commitSha: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

/** A node row joined to the run's OWN graph (FR6.38 — station/route resolved once at clone time, else re-deriving from current YAML rewrites history). Graph facts are null for pre-clone runs whose blueprint is gone. */
function describeNode(
  row: NodeRow,
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
    // Resolved against THIS run's args (FR6.40); null when a placeholder is missing rather than serving a half-built href.
    route: resolveRoute(node?.route, args),
    station: node?.station ?? null,
    stationInherited: node?.station_inherited ?? false,
  };
}

/** GET /api/assembly-runs/{id} — one run: the run row, its nodes, and the Station
 *  each node dispatches to. */
export function assemblyRunReadRoute(
  load: () => Promise<Map<string, AssemblyLine>> = loadBuiltinAssemblyLines,
): ServerRoute {
  return {
    method: "GET",
    path: "/api/assembly-runs/{id}",
    options: { auth: "ingest-token" },
    handler: async (request) => {
      const line = await pipeline().assemblyRuns.getById(request.params.id);

      enforceTrue(line !== null, apiError(404), "assembly line not found");
      const [rows, graph] = await Promise.all([
        pipeline().assemblyRuns.listStationRuns(line.id),
        // The run's own clone; loaded by name only for rows stamped before clones existed (same rule as the walk and reaper).
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

/** Legacy alias for `/api/assembly-runs/{id}`; kept for the deployed web-ui, DELETE once no client calls it (lore-api's withLegacyAlias rule). */
export function legacyAssemblyLineReadRoute(
  load: () => Promise<Map<string, AssemblyLine>> = loadBuiltinAssemblyLines,
): ServerRoute {
  return { ...assemblyRunReadRoute(load), path: "/api/assembly-lines/{id}" };
}

/** GET /api/assembly-line-definitions — the catalog: every line and, per node, the Station it will run on. */
export function assemblyLineCatalogRoute(
  load: () => Promise<Map<string, AssemblyLine>> = loadBuiltinAssemblyLines,
): ServerRoute {
  return {
    method: "GET",
    path: "/api/assembly-line-definitions",
    options: { auth: "ingest-token" },
    handler: async () => {
      const definitions = await load();

      return {
        definitions: [...definitions.values()].map((definition) => ({
          name: definition.name,
          description: definition.description,
          entry: definition.entry,
          exit: definition.exit,
          nodes: definition.nodes.map((node) => {
            const station = resolveNodeStation(node, definition.name);

            return {
              id: node.id,
              type: node.type,
              promptRef: node.prompt_ref ?? null,
              // The catalog has no run, so no args: the TEMPLATE is the answer here.
              route: node.route ?? null,
              station: station.station,
              stationInherited: station.inherited,
            };
          }),
          edges: definition.edges,
        })),
      };
    },
  };
}
