import { describe, it, expect, afterEach, vi } from "vitest";
import Hapi from "@hapi/hapi";
import { loadBuiltinAssemblyLines } from "@re-cinq/lore-assembly-lines";
import { registerBearerAuth } from "../auth.js";

const getById = vi.fn();
const listStationRuns = vi.fn();

vi.mock("../../../kernel/queues.js", () => ({
  assemblyRuns: () => ({ getById, listStationRuns }),
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

  it("reports a human station with no Station and a resolved route", async () => {
    getById.mockResolvedValue(
      line({ args: { repo: "re-cinq/lore", feature_id: "feat-1" } }),
    );
    listStationRuns.mockResolvedValue([node("author", null)]);

    const res = await get("/api/assembly-lines/line-1");

    expect(
      (res.result as { nodes: Record<string, unknown>[] }).nodes[0],
    ).toMatchObject({
      type: "feature_review",
      station: null,
      // Resolved against the RUN's args, so the reader gets a link they can follow.
      route: "/repos/re-cinq/lore/features/feat-1",
    });
  });

  it("describes nodes from the run's OWN graph even when the blueprint is gone", async () => {
    // The clone is the record (FR6.38): a rename or delete of the YAML must not
    // make a run's history undrawable, and an EDIT must not rewrite it.
    getById.mockResolvedValue(
      line({
        blueprintName: "renamed-away",
        graph: {
          name: "renamed-away",
          entry: "author",
          exit: "author",
          nodes: [
            {
              id: "author",
              type: "feature_review",
              station: null,
              station_inherited: false,
              route: "/repos/{args.repo}/features/{args.feature_id}",
            },
          ],
          edges: [],
        },
        args: { repo: "re-cinq/lore", feature_id: "feat-1" },
      }),
    );
    listStationRuns.mockResolvedValue([node("author", null)]);

    const res = await server(async () => new Map()).inject({
      method: "GET",
      url: "/api/assembly-lines/line-1",
      headers: { authorization: "Bearer ingest-secret" },
    });

    expect(res.result).toMatchObject({
      definitionKnown: true,
      nodes: [
        {
          nodeId: "author",
          type: "feature_review",
          station: null,
          route: "/repos/re-cinq/lore/features/feat-1",
        },
      ],
    });
  });

  it("prefers the stored graph's station over the current blueprint's answer", async () => {
    getById.mockResolvedValue(
      line({
        blueprintName: "feature-planning",
        graph: {
          name: "feature-planning",
          entry: "analyze",
          exit: "analyze",
          nodes: [
            {
              id: "analyze",
              type: "agent",
              station: "the-station-the-run-RAN",
              station_inherited: false,
            },
          ],
          edges: [],
        },
      }),
    );
    listStationRuns.mockResolvedValue([node("analyze", "success")]);

    // The CURRENT blueprint says something else — an edit after the run started.
    const res = await get("/api/assembly-lines/line-1");

    expect(
      (res.result as { nodes: Record<string, unknown>[] }).nodes[0],
    ).toMatchObject({
      station: "the-station-the-run-RAN",
      stationInherited: false,
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
