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
    const res = await injectOk(runs, id);

    expect(res.definitionKnown).toBe(false);
  });

  it("enriches each node from the run's blueprint — type, promptRef, station and inheritance", async () => {
    const runs = new InMemoryAssemblyRuns();
    const id = await runs.start({ blueprintName: "code-review", repo: "o/r" });

    await runs.ensureStationRun({
      assemblyRunId: id,
      nodeId: "review",
      iteration: 0,
    });

    const body = await injectOk(runs, id, [
      {
        name: "code-review",
        entry: "review",
        exit: "review",
        nodes: [{ id: "review", type: "agent", prompt_ref: "code-review" }],
        edges: [],
      } as unknown as AssemblyLine,
    ]);

    expect(body.definitionKnown).toBe(true);
    expect(body.nodes[0]).toMatchObject({
      nodeId: "review",
      type: "agent",
      promptRef: "code-review",
      // No station_ref on the node, so it inherits the one named after the line.
      station: "code-review",
      stationInherited: true,
    });
  });

  it("resolves a human station's route against the run's own args", async () => {
    const runs = new InMemoryAssemblyRuns();
    const id = await runs.start({
      blueprintName: "feature-planning",
      repo: "o/r",
      args: { feature_id: "f-42" },
    });

    await runs.ensureStationRun({
      assemblyRunId: id,
      nodeId: "feature-review",
      iteration: 0,
    });

    const body = await injectOk(runs, id, [
      {
        name: "feature-planning",
        entry: "feature-review",
        exit: "feature-review",
        nodes: [
          {
            id: "feature-review",
            type: "human_review",
            route: "/features/{args.feature_id}",
          },
        ],
        edges: [],
      } as unknown as AssemblyLine,
    ]);

    expect(body.nodes[0].route).toBe("/features/f-42");
  });

  it("leaves the route null when the run lacks a placeholder the page needs", async () => {
    const runs = new InMemoryAssemblyRuns();
    const id = await runs.start({
      blueprintName: "implementation",
      repo: "o/r",
    });

    await runs.ensureStationRun({
      assemblyRunId: id,
      nodeId: "pr-review",
      iteration: 0,
    });

    const body = await injectOk(runs, id, [
      {
        name: "implementation",
        entry: "pr-review",
        exit: "pr-review",
        nodes: [
          {
            id: "pr-review",
            type: "human_review",
            route: "{args.pr_url}/files",
          },
        ],
        edges: [],
      } as unknown as AssemblyLine,
    ]);

    // A half-built href sends the reader somewhere that does not exist.
    expect(body.nodes[0].route).toBeNull();
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

    const body = await injectOk(runs, id);

    expect(body.nodes.map((n: { nodeId: string }) => n.nodeId)).toEqual([
      "implement",
      "validate",
    ]);
  });
});

/** Inject, assert the run was found, and parse — so a 404 fails here rather than
 *  flowing on as an unexpected body shape. */
async function injectOk(
  runs: InMemoryAssemblyRuns,
  id: string,
  lines: AssemblyLine[] = [],
) {
  const server = await serve(runs, lines);
  const res = await server.inject(`/api/assembly-runs/${id}`);

  expect(res.statusCode).toBe(200);

  return JSON.parse(res.payload);
}
