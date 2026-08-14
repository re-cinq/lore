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
import { resolveRoute } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import { assemblyLines } from "../../../kernel/queues.js";

interface NodeRow {
  nodeId: string;
  iteration: number;
  outcome: string | null;
  agentCrName: string | null;
  commitSha: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

/** A node row joined to what the definition says about that node. Definition facts are
 *  null when the definition is unknown — a renamed or deleted definition must still
 *  leave its RUNS inspectable, since the rows are the record of what actually ran. */
function describeNode(
  row: NodeRow,
  definition: AssemblyLine | undefined,
  lineTaskType: string,
  args: Record<string, unknown> = {},
) {
  const node = definition?.nodes.find((n) => n.id === row.nodeId);
  const station = node ? resolveNodeStation(node, lineTaskType) : null;

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
    station: station?.station ?? null,
    stationInherited: station?.inherited ?? false,
  };
}

/** GET /api/assembly-lines/{id} — one run: the line, its nodes, and the Station each
 *  node dispatches to. */
export function assemblyLineReadRoute(
  load: () => Promise<Map<string, AssemblyLine>> = loadBuiltinAssemblyLines,
): ServerRoute {
  return {
    method: "GET",
    path: "/api/assembly-lines/{id}",
    options: { auth: "ingest-token" },
    handler: async (request) => {
      const line = await assemblyLines().getById(request.params.id);

      enforceTrue(line !== null, Boom.notFound, "assembly line not found");
      const [rows, definitions] = await Promise.all([
        assemblyLines().listStationRuns(line.id),
        load(),
      ]);
      const definition = definitions.get(line.blueprintName);

      return {
        line,
        definitionKnown: Boolean(definition),
        // A line's task type IS its definition name: a line is started per task type,
        // and an agent node with no station_ref resolves against exactly that.
        nodes: rows.map((row) =>
          describeNode(row, definition, line.blueprintName, line.args),
        ),
      };
    },
  };
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
