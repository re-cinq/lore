import Hapi from "@hapi/hapi";
import { describe, expect, it } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import type { RunGraph } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import { runStationRoute } from "./run-station.js";

const GRAPH: RunGraph = {
  name: "feature-planning",
  entry: "analyze",
  exit: "done",
  nodes: [
    { id: "analyze", type: "agent", station: "s", station_inherited: false },
    { id: "write", type: "agent", station: "s", station_inherited: false },
    {
      id: "done",
      type: "retrospective",
      station: "s",
      station_inherited: false,
    },
  ],
  edges: [],
};

async function serve(runs: InMemoryAssemblyRuns) {
  const server = Hapi.server();

  server.auth.scheme("stub", () => ({
    authenticate: (_request, h) => h.authenticated({ credentials: {} }),
  }));
  server.auth.strategy("bearer-scope", "stub");
  server.auth.default("bearer-scope");
  server.route(
    runStationRoute(
      () => null,
      async () => new Map(),
      runs,
    ),
  );

  return server;
}

describe("POST /api/assembly-runs/{id}/run-station", () => {
  it("answers 201 with the fresh line's id, entered at write, and retires the parked source", async () => {
    const runs = new InMemoryAssemblyRuns();
    const source = await runs.start({
      blueprintName: "feature-planning",
      repo: "re-cinq/lore",
      subjectKey: "plan:p1",
    });

    await runs.stampBlueprint(source, "h", GRAPH);
    await runs.markRunning(source);
    const server = await serve(runs);

    const res = await server.inject({
      method: "POST",
      url: `/api/assembly-runs/${source}/run-station`,
      payload: { node_id: "write", actor: "gedaiu" },
    });
    const { id } = res.result as { id: string };

    expect({
      status: res.statusCode,
      fresh: (await runs.getById(id))?.args.entry_node,
      source: (await runs.getById(source))?.outcome,
    }).toEqual({ status: 201, fresh: "write", source: "cancelled" });
  });

  it("answers 400 for a station the run's graph does not have, and 404 for a run that does not exist", async () => {
    const runs = new InMemoryAssemblyRuns();
    const source = await runs.start({
      blueprintName: "feature-planning",
      repo: "re-cinq/lore",
    });

    await runs.stampBlueprint(source, "h", GRAPH);
    const server = await serve(runs);
    const post = (id: string, node_id: string) =>
      server.inject({
        method: "POST",
        url: `/api/assembly-runs/${id}/run-station`,
        payload: { node_id, actor: "gedaiu" },
      });

    expect([
      (await post(source, "nope")).statusCode,
      (await post("missing", "write")).statusCode,
    ]).toEqual([400, 404]);
  });
});
