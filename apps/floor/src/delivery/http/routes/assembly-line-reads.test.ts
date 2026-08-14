import { describe, it, expect, afterEach, vi } from "vitest";
import Hapi from "@hapi/hapi";
import { loadBuiltinAssemblyLines } from "@re-cinq/lore-assembly-lines";
import { registerBearerAuth } from "../auth.js";

const getById = vi.fn();
const listStationRuns = vi.fn();

vi.mock("../../../kernel/queues.js", () => ({
  assemblyLines: () => ({ getById, listStationRuns }),
}));

const { assemblyLineReadRoute, assemblyLineCatalogRoute } =
  await import("./assembly-line-reads.js");

const ORIG = process.env.LORE_INGEST_TOKEN;

afterEach(() => {
  vi.clearAllMocks();

  if (ORIG === undefined) {
    delete process.env.LORE_INGEST_TOKEN;
  } else {
    process.env.LORE_INGEST_TOKEN = ORIG;
  }
});

const line = (over: Record<string, unknown> = {}) => ({
  id: "line-1",
  blueprintName: "feature-planning",
  taskId: "task-1",
  repo: "re-cinq/lore",
  status: "running",
  ...over,
});

const node = (nodeId: string, outcome: string | null) => ({
  nodeId,
  iteration: 1,
  outcome,
  agentCrName: `cr-${nodeId}`,
  commitSha: null,
  startedAt: new Date("2026-08-12T18:00:00Z"),
  finishedAt: null,
});

function server(load = loadBuiltinAssemblyLines) {
  process.env.LORE_INGEST_TOKEN = "ingest-secret";
  const s = Hapi.server({ port: 0 });

  registerBearerAuth(s);
  s.route(assemblyLineReadRoute(load));
  s.route(assemblyLineCatalogRoute(load));

  return s;
}

const get = (url: string) =>
  server().inject({
    method: "GET",
    url,
    headers: { authorization: "Bearer ingest-secret" },
  });

describe("GET /api/assembly-lines/{id}", () => {
  it("returns the line with its nodes", async () => {
    getById.mockResolvedValue(line());
    listStationRuns.mockResolvedValue([node("analyze", "success")]);

    const res = await get("/api/assembly-lines/line-1");

    expect(res.statusCode).toBe(200);
    expect(res.result).toMatchObject({
      line: { id: "line-1", status: "running" },
      nodes: [{ nodeId: "analyze", outcome: "success" }],
    });
  });

  it("says which STATION each node runs on, and whether it inherited it", async () => {
    // The fact that existed nowhere outside the Floor's dispatch. An agent node with
    // no `station_ref` runs the recipe named after the LINE — which is how every node
    // on the merged planning line ran the planning prompt and reported success. One
    // GET would have shown it.
    getById.mockResolvedValue(line());
    listStationRuns.mockResolvedValue([node("analyze", "success")]);

    const res = await get("/api/assembly-lines/line-1");

    expect(
      (res.result as { nodes: Record<string, unknown>[] }).nodes[0],
    ).toMatchObject({
      type: "agent",
      station: "feature-planning",
      stationInherited: true,
    });
  });

  it("reports a wait node as having no station, since a person is its worker", async () => {
    getById.mockResolvedValue(line());
    listStationRuns.mockResolvedValue([node("author", null)]);

    const res = await get("/api/assembly-lines/line-1");

    expect(
      (res.result as { nodes: Record<string, unknown>[] }).nodes[0],
    ).toMatchObject({
      type: "wait",
      station: null,
      signal: "author_feedback",
    });
  });

  it("returns 404 for a line that does not exist", async () => {
    getById.mockResolvedValue(null);

    expect((await get("/api/assembly-lines/nope")).statusCode).toBe(404);
  });

  it("still returns the rows when the definition is unknown", async () => {
    // A line whose definition was renamed or removed must remain inspectable — the
    // node rows are the record of what actually ran, and refusing to serve them would
    // hide exactly the run someone is trying to debug.
    getById.mockResolvedValue(line({ blueprintName: "gone" }));
    listStationRuns.mockResolvedValue([node("analyze", "success")]);

    const res = await get("/api/assembly-lines/line-1");

    expect(res.statusCode).toBe(200);
    expect(res.result).toMatchObject({
      definitionKnown: false,
      nodes: [{ nodeId: "analyze", type: null, station: null }],
    });
  });

  it("refuses an unauthenticated read", async () => {
    getById.mockResolvedValue(line());

    const res = await server().inject({
      method: "GET",
      url: "/api/assembly-lines/line-1",
    });

    expect(res.statusCode).toBe(401);
  });
});

describe("GET /api/assembly-line-definitions", () => {
  it("lists every definition with each node's type and declared station", async () => {
    const res = await get("/api/assembly-line-definitions");

    expect(res.statusCode).toBe(200);

    const found = (
      res.result as { definitions: { name: string; nodes: unknown[] }[] }
    ).definitions.find((d) => d.name === "feature-planning");

    expect(found?.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "analyse-specs",
          station: "spec-analysis",
          stationInherited: false,
        }),
      ]),
    );
  });
});
