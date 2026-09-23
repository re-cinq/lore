// POST /api/assembly-runs/{id}/run-station — run any station of a line, at any time (specs/fork-rerun-from-node FR8).

import type { Request, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import type { Pool } from "pg";
import { z } from "zod";
import {
  loadBuiltinAssemblyLines,
  resolveRunGraph,
  type AssemblyLine,
} from "@re-cinq/lore-assembly-lines";
import type { AssemblyRunsPort } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { resolvePort } from "./run-read.js";
import { runStation } from "../../../work/assembly-runs/run-station.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";

const RunStationBody = z.object({
  node_id: z.string().min(1).max(200),
  actor: z.string().min(1).max(200),
});

const RunStationSchema = z.object({ id: z.string() });

type LoadDefinitions = () => Promise<Map<string, AssemblyLine>>;

interface RunStationDeps {
  getPool: () => Pool | null;
  load: LoadDefinitions;
  runs?: AssemblyRunsPort;
}

const RUN_STATION_OPTIONS = zodResponse(
  {
    ...bearerScope("task"),
    validate: { payload: zodValidate(RunStationBody) },
  },
  RunStationSchema,
  {
    name: "AssemblyRunStationStarted",
    status: 201,
    description:
      "A fresh line on the same work, entered at the named station; an open source line is retired first",
    errors: [400, 404, 409],
  },
);

export function runStationRoute(
  getPool: () => Pool | null,
  load: LoadDefinitions = loadBuiltinAssemblyLines,
  runs?: AssemblyRunsPort,
): ServerRoute {
  return {
    method: "POST",
    path: "/api/assembly-runs/{id}/run-station",
    options: RUN_STATION_OPTIONS,
    handler: (request, h) =>
      serveRunStation({ getPool, load, runs }, request, h),
  };
}

async function serveRunStation(
  deps: RunStationDeps,
  request: Request,
  h: ResponseToolkit,
) {
  const port = resolvePort(deps.getPool(), deps.runs);
  const { node_id, actor } = request.payload as z.infer<typeof RunStationBody>;
  const id = await runStation(
    port,
    (line) => resolveRunGraph(line, deps.load),
    {
      runId: String(request.params.id),
      nodeId: node_id,
      actor,
    },
  );

  return h.response({ id }).code(201);
}
