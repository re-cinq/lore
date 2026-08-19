// Read access to assembly lines over HTTP.
//
// Until now nothing outside the web UI could see a line: the UI reads
// `pipeline.assembly_runs` straight from Postgres, and no service exposed it. So
// "which node is this line on, which Station is that, which recipe does it run" was
// answerable only by something holding a database connection.
//
// These live on the FLOOR, not lore-api, and the boundary is the reason: the Station
// resolution needs the assembly-line definitions, which are baked into the Floor's
// image and deliberately absent from lore-api's lean one. Putting them there made the
// lore-api container fail to build — the dependency resolved through workspace
// hoisting locally and did not exist in Docker.
//
// The Station is the field worth serving. It carries the RECIPE — the prompt template
// and the `output.watch` that decides what artifact a run can produce — and an agent
// node that declares no `station_ref` INHERITS the one named after its line's task
// type. That inheritance silently ran the planning prompt for every node on the merged
// planning line; `stationInherited` puts it in the response rather than leaving it to
// be reconstructed from YAML.

import Boom from "@hapi/boom";
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
import { graphForRun } from "@re-cinq/lore-assembly-lines";
import { assemblyRuns } from "../../../kernel/queues.js";

interface NodeRow {
  nodeId: string;
  iteration: number;
  outcome: string | null;
  agentCrName: string | null;
  commitSha: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

/** A node row joined to what the run's OWN graph says about that node (FR6.38 —
 *  station and route were resolved once, at clone time; re-deriving them from the
 *  current YAML is how an edited blueprint rewrote a run's history). Graph facts
 *  are null when the run predates clones AND its blueprint is gone — the rows are
 *  the record of what actually ran, so they still serve. */
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
    // The page a HUMAN station's worker acts on, resolved against THIS run's args
    // (FR6.40) — `pr_url` does not exist until the push node opened the PR, so a
    // route resolved any earlier would name a page that is not there yet. Null
    // when the run does not carry every placeholder: a half-built href sends the
    // reader somewhere that does not exist, which is worse than no link.
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
      const line = await assemblyRuns().getById(request.params.id);

      enforceTrue(line !== null, Boom.notFound, "assembly line not found");
      const [rows, graph] = await Promise.all([
        assemblyRuns().listStationRuns(line.id),
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

/** Legacy path for the run read — this route reads a RUN, so it moved to
 *  `/api/assembly-runs/{id}`; the old spelling stays because the deployed web-ui
 *  still calls it and ships as its own image. DELETE once no deployed client
 *  calls it (same rule as lore-api's withLegacyAlias). */
export function legacyAssemblyLineReadRoute(
  load: () => Promise<Map<string, AssemblyLine>> = loadBuiltinAssemblyLines,
): ServerRoute {
  return { ...assemblyRunReadRoute(load), path: "/api/assembly-lines/{id}" };
}

/** GET /api/assembly-line-definitions — the catalog: every line and, per node, the
 *  Station it will run on. Reading this is how you learn a node's recipe without
 *  opening YAML or asking Kubernetes. */
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
