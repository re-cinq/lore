// Read access to assembly lines over HTTP. Lives on the FLOOR, not lore-api, because Station resolution needs the assembly-line definitions baked into the Floor's image (they fail to build in lore-api's lean container).

import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { ServerRoute } from "@hapi/hapi";
import {
  loadBuiltinAssemblyLines,
  resolveNodeStation,
  type AssemblyLine,
} from "@re-cinq/lore-assembly-lines";
import {
  describeStationRun,
  type RunGraphNode,
  type StationRunFacts,
} from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import { resolveRunGraph } from "@re-cinq/lore-assembly-lines";
import { pipeline } from "../../../outbound/queues.js";

/** Each node row paired with its own graph node, matched by id; an unmatched row still describes itself. */
function describeNodes(
  rows: readonly StationRunFacts[],
  nodes: readonly RunGraphNode[] | undefined,
  args: Record<string, unknown>,
) {
  return rows.map((row) =>
    describeStationRun(
      row,
      nodes?.find((node) => node.id === row.nodeId),
      args,
    ),
  );
}

/** The body of GET /api/assembly-runs/{id}: the run row, its node rows, and the Station each node resolved to. 404s on an unknown id. */
async function readAssemblyRun(
  id: string,
  load: () => Promise<Map<string, AssemblyLine>>,
) {
  const line = await pipeline().assemblyRuns.getById(id);

  enforceTrue(line !== null, apiError(404), "assembly line not found");
  const [rows, graph] = await Promise.all([
    pipeline().assemblyRuns.listStationRuns(line.id),
    // The run's own clone; loaded by name only for rows stamped before clones existed (same rule as the walk and reaper).
    resolveRunGraph(line, load),
  ]);

  return {
    line,
    definitionKnown: Boolean(graph),
    nodes: describeNodes(rows, graph?.nodes, line.args),
  };
}

/** GET /api/assembly-runs/{id}: run row, nodes, and Station per node. */
export function assemblyRunReadRoute(
  load: () => Promise<Map<string, AssemblyLine>> = loadBuiltinAssemblyLines,
): ServerRoute {
  return {
    method: "GET",
    path: "/api/assembly-runs/{id}",
    options: { auth: "ingest-token" },
    handler: (request) => readAssemblyRun(request.params.id, load),
  };
}

/** Legacy alias for `/api/assembly-runs/{id}`; kept for the deployed web-ui, DELETE once no client calls it (lore-api's withLegacyAlias rule). */
export function legacyAssemblyLineReadRoute(
  load: () => Promise<Map<string, AssemblyLine>> = loadBuiltinAssemblyLines,
): ServerRoute {
  return { ...assemblyRunReadRoute(load), path: "/api/assembly-lines/{id}" };
}

/** GET /api/assembly-line-definitions — the catalog: every line and, per node, the Station it will run on. */
/** One definition as the catalog serves it. There is no RUN here, so nodes carry their template `route` rather than resolved args — the catalog answers "what would this line do", not "what did it do". */
function catalogEntry(definition: AssemblyLine) {
  return {
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
        route: node.route ?? null,
        station: station.station,
        stationInherited: station.inherited,
      };
    }),
    edges: definition.edges,
  };
}

export function assemblyLineCatalogRoute(
  load: () => Promise<Map<string, AssemblyLine>> = loadBuiltinAssemblyLines,
): ServerRoute {
  return {
    method: "GET",
    path: "/api/assembly-line-definitions",
    options: { auth: "ingest-token" },
    handler: async () => ({
      definitions: [...(await load()).values()].map(catalogEntry),
    }),
  };
}
