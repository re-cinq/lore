import Hapi from "@hapi/hapi";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
import type { RunGraph } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import { buildServer } from "../../../server/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";
import { assemblyLineRoutes } from "./assembly-lines.js";

const originalEnv = { ...process.env };

/** Postgres "relation does not exist" — a pre-0025 database has no assembly-line
 *  tables at all, and every one of these reads answers empty rather than 500. */
const undefinedTable = () =>
  Object.assign(new Error("relation does not exist"), { code: "42P01" });

const GRAPH: RunGraph = {
  name: "code-review",
  entry: "review",
  exit: "done",
  nodes: [
    {
      id: "review",
      type: "agent",
      station: "code-review",
      station_inherited: false,
    },
  ],
  edges: [],
};

describe("assembly-line reads", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  function get(url: string, pool: unknown = makePool()) {
    return buildServer(() => pool as never).inject({
      method: "GET",
      url,
      headers: AUTH,
    });
  }

  /**
   * The routes over a REAL port, the way `run-read.test.ts` serves its own.
   *
   * WHICH runs a read answers with is the port's decision now, so asserting it
   * against the in-memory implementation exercises the same filter, order and
   * limit the Postgres one is held to by the port's contract test — rather than
   * asserting the shape of a SQL string, which stayed green through a renamed
   * column once already.
   */
  async function servePort(runs: InMemoryAssemblyRuns, pool = makePool()) {
    const server = Hapi.server();

    server.auth.scheme("stub", () => ({
      authenticate: (_r, h) => h.authenticated({ credentials: {} }),
    }));
    server.auth.strategy("bearer-scope", "stub");
    server.auth.default("bearer-scope");
    // Only `pipeline.tasks` and `pipeline.llm_calls` are read through the pool
    // now; an empty answer leaves every enriched field null.
    pool.query.mockResolvedValue({ rows: [] });
    server.route(assemblyLineRoutes(() => pool as never, runs));

    return server;
  }

  describe("both path spellings are served", () => {
    // web-ui ships as a separate image in the same umbrella release, so for the
    // length of a rollout one side is always older than the other. Whichever way
    // round that falls, the call has to land.
    it.each([
      ["/api/assembly-runs", "/api/assembly-lines"],
      ["/api/assembly-runs/run-1", "/api/assembly-lines/run-1"],
      ["/api/assembly-runs/run-1/nodes", "/api/assembly-lines/run-1/nodes"],
      [
        "/api/assembly-runs/run-1/token-usage",
        "/api/assembly-lines/run-1/token-usage",
      ],
    ])(
      "serves %s and its pre-rename alias %s alike",
      async (canonical, legacy) => {
        expect((await get(canonical)).statusCode).toBe(
          (await get(legacy)).statusCode,
        );
      },
    );
  });

  describe("GET /api/assembly-lines", () => {
    it("returns 503 when pool is null", async () => {
      expect((await get("/api/assembly-lines", null)).statusCode).toBe(503);
    });

    it("returns the run rows", async () => {
      const runs = new InMemoryAssemblyRuns();
      const id = await runs.start({
        blueprintName: "code-review",
        repo: "re-cinq/lore",
      });
      const server = await servePort(runs);

      const res = await server.inject("/api/assembly-lines");

      expect(res.statusCode).toBe(200);
      expect((res.result as { runs: unknown[] }).runs).toMatchObject([
        { id, blueprint_name: "code-review", repo: "re-cinq/lore" },
      ]);
    });

    it("narrows by status, repo, blueprint and subject together", async () => {
      const runs = new InMemoryAssemblyRuns();
      const wanted = await runs.start({
        blueprintName: "code-review",
        repo: "re-cinq/lore",
        subjectKey: "feature:one",
      });

      await runs.markRunning(wanted);
      await runs.start({
        blueprintName: "implementation",
        repo: "re-cinq/lore",
      });
      await runs.start({ blueprintName: "code-review", repo: "re-cinq/other" });
      const server = await servePort(runs);

      const res = await server.inject(
        "/api/assembly-lines?status=running&repo=re-cinq/lore&blueprint=code-review&subject_key=feature:one&limit=5",
      );

      expect(
        (res.result as { runs: Array<{ id: string }> }).runs.map((r) => r.id),
      ).toEqual([wanted]);
    });

    it("narrows to one blueprint on its own, which nothing could ask for before", async () => {
      const runs = new InMemoryAssemblyRuns();
      const wanted = await runs.start({
        blueprintName: "code-review",
        repo: "re-cinq/lore",
      });

      await runs.start({
        blueprintName: "implementation",
        repo: "re-cinq/lore",
      });
      const server = await servePort(runs);

      const res = await server.inject(
        "/api/assembly-lines?blueprint=code-review",
      );

      expect(
        (res.result as { runs: Array<{ id: string }> }).runs.map((r) => r.id),
      ).toEqual([wanted]);
    });

    it("caps an unfiltered browse at fifty runs", async () => {
      const runs = new InMemoryAssemblyRuns();

      for (let i = 0; i < 51; i++) {
        await runs.start({
          blueprintName: "code-review",
          repo: "re-cinq/lore",
        });
      }
      const server = await servePort(runs);

      const res = await server.inject("/api/assembly-lines");

      expect((res.result as { runs: unknown[] }).runs).toHaveLength(50);
    });

    it("returns the newest run for a task when task_id is given", async () => {
      const runs = new InMemoryAssemblyRuns();

      await runs.start({
        blueprintName: "code-review",
        repo: "re-cinq/lore",
        taskId: "11111111-1111-4111-8111-111111111111",
      });
      const server = await servePort(runs);

      const res = await server.inject(
        "/api/assembly-lines?task_id=11111111-1111-4111-8111-111111111111&limit=1",
      );

      expect((res.result as { runs: unknown[] }).runs).toHaveLength(1);
    });

    it("returns an empty list on a pre-0025 database", async () => {
      const pool = makePool();

      pool.query.mockRejectedValue(undefinedTable());
      const res = await get("/api/assembly-lines", pool);

      expect(res.statusCode).toBe(200);
      expect(res.result).toEqual({ runs: [] });
    });

    it("browse rows skip the graph clone nothing in a table reads", async () => {
      const runs = new InMemoryAssemblyRuns();
      const id = await runs.start({
        blueprintName: "code-review",
        repo: "re-cinq/lore",
      });

      await runs.stampBlueprint(id, "hash", GRAPH);
      const server = await servePort(runs);

      const res = await server.inject("/api/assembly-lines?repo=re-cinq/lore");

      expect((res.result as { runs: object[] }).runs[0]).not.toHaveProperty(
        "graph",
      );
    });

    it("by-task rows keep the graph (the wizard draws it)", async () => {
      const runs = new InMemoryAssemblyRuns();
      const taskId = "22222222-2222-4222-8222-222222222222";
      const id = await runs.start({
        blueprintName: "code-review",
        repo: "re-cinq/lore",
        taskId,
      });

      await runs.stampBlueprint(id, "hash", GRAPH);
      const server = await servePort(runs);

      const res = await server.inject(`/api/assembly-lines?task_id=${taskId}`);

      expect(
        (res.result as { runs: Array<{ graph: RunGraph }> }).runs[0].graph,
      ).toMatchObject({ name: "code-review" });
    });

    it("the cost lateral reads llm_calls.assembly_line_id — the column that exists", async () => {
      // The telemetry tables deliberately kept the pre-rename column (0040);
      // querying the new spelling here 42703s every run read after deploy.
      const runs = new InMemoryAssemblyRuns();

      await runs.start({ blueprintName: "code-review", repo: "re-cinq/lore" });
      const pool = makePool();
      const server = await servePort(runs, pool);

      await server.inject("/api/assembly-lines");

      expect(pool.query.mock.calls[0][0]).toContain("lc.assembly_line_id");
      expect(pool.query.mock.calls[0][0]).not.toContain("lc.assembly_run_id");
    });

    it("maps the enrichment row onto the run it belongs to", async () => {
      // Every other test in this file answers the pool with no rows, which
      // leaves the enriched half of a run row null whatever the mapping does.
      const runs = new InMemoryAssemblyRuns();
      const id = await runs.start({
        blueprintName: "code-review",
        repo: "re-cinq/lore",
        taskId: "task-1",
        args: { pr_number: 42 },
      });
      const pool = makePool();
      // After servePort, which installs the empty-answer default.
      const server = await servePort(runs, pool);

      pool.query.mockResolvedValue({
        rows: [
          {
            id,
            pr_url: "https://github.com/re-cinq/lore/pull/42",
            task_pr_number: 42,
            created_by: "gedaiu",
            cost_usd: 1.25,
          },
        ],
      });

      const res = await server.inject("/api/assembly-lines");

      expect((res.result as { runs: object[] }).runs[0]).toMatchObject({
        id,
        pr_url: "https://github.com/re-cinq/lore/pull/42",
        task_pr_number: 42,
        created_by: "gedaiu",
        cost_usd: 1.25,
        args_pr_number: 42,
      });
    });

    it("falls back to args.actor when the task row names no author", async () => {
      const runs = new InMemoryAssemblyRuns();

      await runs.start({
        blueprintName: "code-review",
        repo: "re-cinq/lore",
        args: { actor: "lore-agent" },
      });
      const pool = makePool();
      const server = await servePort(runs, pool);

      const res = await server.inject("/api/assembly-lines");

      expect((res.result as { runs: object[] }).runs[0]).toMatchObject({
        created_by: "lore-agent",
        cost_usd: null,
        pr_url: null,
      });
    });

    it.each([
      ["an explicit null", null, null],
      ["an empty string", "", null],
      ["a non-numeric string", "not-a-pr", null],
      ["a numeric string", "42", 42],
      ["a number", 7, 7],
    ])(
      "answers args_pr_number null for %s",
      async (_case, prNumber, expected) => {
        // `Number(null)` and `Number("")` are both a finite 0, so a bare
        // coercion served PR #0 — a link to a pull request that does not exist.
        const runs = new InMemoryAssemblyRuns();

        await runs.start({
          blueprintName: "code-review",
          repo: "re-cinq/lore",
          args: { pr_number: prNumber },
        });
        const server = await servePort(runs);

        const res = await server.inject("/api/assembly-lines");

        expect((res.result as { runs: object[] }).runs[0]).toMatchObject({
          args_pr_number: expected,
        });
      },
    );

    it("rows carry definition_name for the pre-rename web-ui behind the alias", async () => {
      const runs = new InMemoryAssemblyRuns();

      await runs.start({ blueprintName: "code-review", repo: "re-cinq/lore" });
      const server = await servePort(runs);

      const res = await server.inject("/api/assembly-lines");

      expect((res.result as { runs: object[] }).runs[0]).toMatchObject({
        blueprint_name: "code-review",
        definition_name: "code-review",
      });
    });
  });

  describe("GET /api/assembly-lines/{id}", () => {
    it("carries the graph clone and the definition_name alias", async () => {
      const runs = new InMemoryAssemblyRuns();
      const id = await runs.start({
        blueprintName: "code-review",
        repo: "re-cinq/lore",
      });

      await runs.stampBlueprint(id, "hash", GRAPH);
      const server = await servePort(runs);

      const res = await server.inject(`/api/assembly-lines/${id}`);

      expect(res.result).toMatchObject({
        definition_name: "code-review",
        graph: { name: "code-review" },
      });
    });

    it("returns the run", async () => {
      const runs = new InMemoryAssemblyRuns();
      const id = await runs.start({
        blueprintName: "code-review",
        repo: "re-cinq/lore",
      });
      const server = await servePort(runs);

      expect(
        (await server.inject(`/api/assembly-lines/${id}`)).result,
      ).toMatchObject({ id });
    });

    it("returns 404 for an id no run holds", async () => {
      const server = await servePort(new InMemoryAssemblyRuns());

      expect((await server.inject("/api/assembly-lines/gone")).statusCode).toBe(
        404,
      );
    });

    it("returns 404 rather than 500 on a pre-0025 database", async () => {
      const pool = makePool();

      pool.query.mockRejectedValue(undefinedTable());

      expect((await get("/api/assembly-lines/run-1", pool)).statusCode).toBe(
        404,
      );
    });
  });

  describe("GET /api/assembly-lines/{id}/nodes", () => {
    it("returns the node rows in visit order", async () => {
      const runs = new InMemoryAssemblyRuns();
      const id = await runs.start({
        blueprintName: "code-review",
        repo: "re-cinq/lore",
      });

      await runs.ensureStationRun({
        assemblyRunId: id,
        nodeId: "review",
        iteration: 1,
      });
      await runs.ensureStationRun({
        assemblyRunId: id,
        nodeId: "done",
        iteration: 1,
      });
      const server = await servePort(runs);

      const res = await server.inject(`/api/assembly-lines/${id}/nodes`);

      expect(
        (res.result as { nodes: Array<{ node_id: string }> }).nodes.map(
          (n) => n.node_id,
        ),
      ).toEqual(["review", "done"]);
    });

    it("each node row carries its station_run_id — the visit's identity (FR6.39)", async () => {
      const runs = new InMemoryAssemblyRuns();
      const id = await runs.start({
        blueprintName: "code-review",
        repo: "re-cinq/lore",
      });
      const { stationRunId } = await runs.ensureStationRun({
        assemblyRunId: id,
        nodeId: "review",
        iteration: 1,
      });
      const server = await servePort(runs);

      const res = await server.inject(`/api/assembly-lines/${id}/nodes`);

      expect((res.result as { nodes: object[] }).nodes[0]).toMatchObject({
        station_run_id: stationRunId,
      });
    });

    it("returns an empty list on a pre-0025 database", async () => {
      const pool = makePool();

      pool.query.mockRejectedValue(undefinedTable());

      expect(
        (await get("/api/assembly-lines/run-1/nodes", pool)).result,
      ).toEqual({ nodes: [] });
    });
  });

  describe("GET /api/assembly-lines/{id}/token-usage", () => {
    it("sums the usage scalars across the run's turns", async () => {
      const pool = makePool();
      const usage = {
        input_tokens: 10,
        output_tokens: 4,
        cache_creation_tokens: 0,
        cache_read_tokens: 2,
      };

      pool.query.mockResolvedValue({ rows: [usage] });
      const res = await get("/api/assembly-lines/run-1/token-usage", pool);

      expect(res.result).toEqual({ usage });
      // agent_run_turns deliberately kept the pre-rename column (0040) —
      // the new spelling here 42703s the endpoint after deploy.
      expect(pool.query.mock.calls[0][0]).toContain(
        "WHERE assembly_line_id = $1",
      );
    });

    it("answers a null usage when the run has reported no turns yet", async () => {
      const pool = makePool();

      pool.query.mockResolvedValue({ rows: [] });

      expect(
        (await get("/api/assembly-lines/run-1/token-usage", pool)).result,
      ).toEqual({ usage: null });
    });

    it("answers a null usage rather than 500 on a pre-0037 database", async () => {
      const pool = makePool();

      pool.query.mockRejectedValue(undefinedTable());

      expect(
        (await get("/api/assembly-lines/run-1/token-usage", pool)).result,
      ).toEqual({ usage: null });
    });
  });
});
