// Read access to assembly lines over HTTP.
//
// Until now nothing outside the web UI could see a line at all: the UI reads
// `pipeline.assembly_lines` straight from Postgres, and lore-api exposed nothing. So
// "which node is this line on, which Station is that, which recipe does it run" was
// answerable only by something holding a database connection — which is why a whole
// evening's debugging happened in psql and kubectl.
//
// The Station is the part worth serving. It carries the RECIPE — the prompt template
// and the `output.watch` that decides what artifact a run can produce — and an agent
// node that declares no `station_ref` INHERITS the one named after its line's task
// type. That inheritance is what silently ran the planning prompt for every node on
// the merged planning line; `stationInherited` puts it in the response rather than
// leaving it to be reconstructed from YAML.

import type { ServerRoute } from "@hapi/hapi";
import {
  loadBuiltinAssemblyLines,
  resolveNodeStation,
  type AssemblyLine,
} from "@re-cinq/lore-assembly-lines";
import { projectFor } from "../../../platform/project-boot.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/** A node row joined to what the definition says about that node. Definition facts
 *  are null when the definition is unknown — a renamed or deleted definition must
 *  still leave its RUNS inspectable, since the rows are the record of what ran. */
function describeNode(
  row: {
    nodeId: string;
    iteration: number;
    outcome: string | null;
    agentCrName: string | null;
    commitSha: string | null;
    startedAt: Date;
    finishedAt: Date | null;
  },
  definition: AssemblyLine | undefined,
  lineTaskType: string,
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
    signal: node?.signal ?? null,
    station: station?.station ?? null,
    stationInherited: station?.inherited ?? false,
  };
}

export function assemblyLineRoutes(): ServerRoute[] {
  return [
    // GET /api/assembly-lines/{id} — one run: the line, its nodes, and the Station
    // each node dispatches to.
    {
      method: "GET",
      path: "/api/assembly-lines/{id}",
      options: bearerScope("read"),
      handler: async (request, h) => {
        try {
          // A line carries its own repo, but the facade is repo-scoped, so the lookup
          // needs one first. Any project reaches the same table; the row's own repo is
          // what the response reports.
          const project = await projectFor(
            (request.query.repo as string | undefined) ?? "",
          );
          const line = await project.assemblyLines.getById(request.params.id);

          if (!line) {
            return h.response({ error: "assembly line not found" }).code(404);
          }
          const [rows, definitions] = await Promise.all([
            project.assemblyLines.listNodes(line.id),
            loadBuiltinAssemblyLines(),
          ]);
          const definition = definitions.get(line.definitionName);
          // The line's task type IS its definition name: a line is started per task
          // type, and an agent node with no station_ref resolves against exactly that.
          const taskType = line.definitionName;

          return h.response({
            line,
            definitionKnown: Boolean(definition),
            nodes: rows.map((row) => describeNode(row, definition, taskType)),
          });
        } catch (err) {
          return h.response({ error: errorMessage(err) }).code(500);
        }
      },
    },

    // GET /api/assembly-line-definitions — the catalog: every line and, per node, the
    // Station it will run on. Reading this is how you learn a node's recipe without
    // opening YAML or asking Kubernetes.
    {
      method: "GET",
      path: "/api/assembly-line-definitions",
      options: bearerScope("read"),
      handler: async (_request, h) => {
        try {
          const definitions = await loadBuiltinAssemblyLines();

          return h.response({
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
                  signal: node.signal ?? null,
                  station: station.station,
                  stationInherited: station.inherited,
                };
              }),
              edges: definition.edges,
            })),
          });
        } catch (err) {
          return h.response({ error: errorMessage(err) }).code(500);
        }
      },
    },
  ];
}
