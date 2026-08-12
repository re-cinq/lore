import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../platform/project-boot.js", () => ({ projectFor: vi.fn() }));

import { buildServer } from "../../../server/build-server.js";
import { projectFor } from "../../../platform/project-boot.js";
import {
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

const line = (over: Record<string, unknown> = {}) => ({
  id: "line-1",
  definitionName: "feature-planning",
  taskId: "task-1",
  repo: "re-cinq/lore",
  branch: "lore/feature/x",
  args: { feature_id: "f1" },
  status: "running",
  outcome: null,
  reason: null,
  createdAt: new Date("2026-08-12T18:00:00Z"),
  startedAt: new Date("2026-08-12T18:00:01Z"),
  finishedAt: null,
  ...over,
});

const node = (nodeId: string, outcome: string | null) => ({
  id: `row-${nodeId}`,
  assemblyLineId: "line-1",
  nodeId,
  iteration: 1,
  outcome,
  agentCrName: `cr-${nodeId}`,
  commitSha: null,
  startedAt: new Date("2026-08-12T18:00:02Z"),
  finishedAt: null,
});

function useProject(over: Record<string, unknown> = {}) {
  const assemblyLines = {
    getById: vi.fn().mockResolvedValue(line()),
    listNodes: vi
      .fn()
      .mockResolvedValue([node("analyze", "success"), node("author", null)]),
    ...over,
  };

  vi.mocked(projectFor).mockResolvedValue({ assemblyLines } as never);

  return assemblyLines;
}

const get = (url: string) =>
  buildServer(() => null).inject({ method: "GET", url, headers: AUTH });

describe("GET /api/assembly-lines/{id}", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    vi.clearAllMocks();
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns the line with its nodes", async () => {
    useProject();
    const res = await get("/api/assembly-lines/line-1");

    expect(res.statusCode).toBe(200);
    expect(res.result).toMatchObject({
      line: {
        id: "line-1",
        definitionName: "feature-planning",
        status: "running",
      },
      nodes: [
        { nodeId: "analyze", outcome: "success" },
        { nodeId: "author", outcome: null },
      ],
    });
  });

  it("says which STATION each node runs on, and whether it inherited it", async () => {
    // The fact that existed nowhere outside the Floor's dispatch. An agent node with
    // no `station_ref` runs the recipe named after the LINE — which is how every node
    // on the merged planning line ran the planning prompt and reported success. One
    // GET would have shown it.
    useProject();
    const res = await get("/api/assembly-lines/line-1");
    const nodes = (res.result as { nodes: Record<string, unknown>[] }).nodes;

    expect(nodes[0]).toMatchObject({
      nodeId: "analyze",
      type: "agent",
      station: "feature-planning",
      stationInherited: true,
    });
  });

  it("reports a wait node as having no station, since a person is its worker", async () => {
    useProject();
    const res = await get("/api/assembly-lines/line-1");
    const nodes = (res.result as { nodes: Record<string, unknown>[] }).nodes;

    expect(nodes[1]).toMatchObject({
      nodeId: "author",
      type: "wait",
      station: null,
      signal: "author_feedback",
    });
  });

  it("returns 404 for a line that does not exist", async () => {
    useProject({ getById: vi.fn().mockResolvedValue(null) });

    expect((await get("/api/assembly-lines/nope")).statusCode).toBe(404);
  });

  it("still returns the rows when the definition is unknown", async () => {
    // A line whose definition was renamed or removed must remain inspectable — the
    // node rows are the record of what actually ran, and refusing to serve them
    // would hide exactly the run someone is trying to debug.
    useProject({
      getById: vi.fn().mockResolvedValue(line({ definitionName: "gone" })),
    });
    const res = await get("/api/assembly-lines/line-1");

    expect(res.statusCode).toBe(200);
    expect(
      (res.result as { nodes: Record<string, unknown>[] }).nodes[0],
    ).toMatchObject({ nodeId: "analyze", station: null, type: null });
  });
});

describe("GET /api/assembly-line-definitions", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
    vi.clearAllMocks();
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

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
          type: "agent",
          station: "spec-analysis",
          stationInherited: false,
        }),
      ]),
    );
  });
});
