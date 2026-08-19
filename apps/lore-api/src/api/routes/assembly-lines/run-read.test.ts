import Hapi from "@hapi/hapi";
import { describe, expect, it } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import type { AssemblyLine } from "@re-cinq/lore-assembly-lines";
import { runReadRoute } from "./run-read.js";

async function serve(runs: InMemoryAssemblyRuns, lines: AssemblyLine[] = []) {
  const server = Hapi.server();

  server.auth.scheme("stub", () => ({
    authenticate: (_r, h) => h.authenticated({ credentials: {} }),
  }));
  server.auth.strategy("bearer-scope", "stub");
  server.auth.default("bearer-scope");
  server.route(
    runReadRoute(
      () => null,
      async () => new Map(lines.map((l) => [l.name, l])),
      runs,
    ),
  );

  return server;
}

describe("GET /api/assembly-runs/{id}", () => {
  it("returns 404 for a run that does not exist", async () => {
    const server = await serve(new InMemoryAssemblyRuns());
    const res = await server.inject("/api/assembly-runs/nope");

    expect(res.statusCode).toBe(404);
  });

  it("reports definitionKnown false when the run carries no graph and its blueprint is gone", async () => {
    const runs = new InMemoryAssemblyRuns();
    const id = await runs.start({ blueprintName: "vanished", repo: "o/r" });
    const res = await server404Safe(runs, id);

    expect(res.definitionKnown).toBe(false);
  });

  it("serves one node row per station run, in visit order", async () => {
    const runs = new InMemoryAssemblyRuns();
    const id = await runs.start({ blueprintName: "vanished", repo: "o/r" });

    await runs.ensureStationRun({
      assemblyRunId: id,
      nodeId: "implement",
      iteration: 0,
    });
    await runs.ensureStationRun({
      assemblyRunId: id,
      nodeId: "validate",
      iteration: 0,
    });

    const body = await server404Safe(runs, id);

    expect(body.nodes.map((n: { nodeId: string }) => n.nodeId)).toEqual([
      "implement",
      "validate",
    ]);
  });
});

/** Inject and parse, failing loudly rather than returning a 404 body as data. */
async function server404Safe(runs: InMemoryAssemblyRuns, id: string) {
  const server = await serve(runs);
  const res = await server.inject(`/api/assembly-runs/${id}`);

  expect(res.statusCode).toBe(200);

  return JSON.parse(res.payload);
}
