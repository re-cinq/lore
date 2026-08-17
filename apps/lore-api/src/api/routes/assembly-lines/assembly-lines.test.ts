import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

/** Postgres "relation does not exist" — a pre-0025 database has no assembly-line
 *  tables at all, and every one of these reads answers empty rather than 500. */
const undefinedTable = () =>
  Object.assign(new Error("relation does not exist"), { code: "42P01" });

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
      const pool = makePool();
      const runs = [{ id: "run-1", status: "running", repo: "re-cinq/lore" }];

      pool.query.mockResolvedValue({ rows: runs });

      const res = await get("/api/assembly-lines", pool);

      expect(res.statusCode).toBe(200);
      expect(res.result).toEqual({ runs });
    });

    it("passes status, repo, blueprint and limit to the query as bound parameters", async () => {
      const pool = makePool();

      pool.query.mockResolvedValue({ rows: [] });
      await get(
        "/api/assembly-lines?status=running&repo=re-cinq/lore&blueprint=code-review&limit=5",
        pool,
      );

      expect(pool.query.mock.calls[0][1]).toEqual([
        "running",
        "re-cinq/lore",
        "code-review",
        5,
      ]);
    });

    it("narrows to one blueprint on its own, which nothing could ask for before", async () => {
      const pool = makePool();

      pool.query.mockResolvedValue({ rows: [] });
      await get("/api/assembly-lines?blueprint=code-review", pool);

      expect(pool.query.mock.calls[0][0]).toContain("al.blueprint_name = $3");
      expect(pool.query.mock.calls[0][1]).toEqual([
        null,
        null,
        "code-review",
        50,
      ]);
    });

    it("defaults an absent filter to null and the limit to 50", async () => {
      const pool = makePool();

      pool.query.mockResolvedValue({ rows: [] });
      await get("/api/assembly-lines", pool);

      expect(pool.query.mock.calls[0][1]).toEqual([null, null, null, 50]);
    });

    it("returns the newest run for a task when task_id is given", async () => {
      const pool = makePool();

      pool.query.mockResolvedValue({ rows: [{ id: "run-2" }] });
      const res = await get("/api/assembly-lines?task_id=t1&limit=1", pool);

      expect(pool.query.mock.calls[0][0]).toContain("al.task_id = $1");
      expect(pool.query.mock.calls[0][1]).toEqual(["t1", 1]);
      expect(res.result).toEqual({ runs: [{ id: "run-2" }] });
    });

    it("returns an empty list on a pre-0025 database", async () => {
      const pool = makePool();

      pool.query.mockRejectedValue(undefinedTable());
      const res = await get("/api/assembly-lines", pool);

      expect(res.statusCode).toBe(200);
      expect(res.result).toEqual({ runs: [] });
    });

    it("browse rows skip the graph clone nothing in a table reads", async () => {
      const pool = makePool();

      pool.query.mockResolvedValue({ rows: [] });
      await get("/api/assembly-lines?repo=re-cinq/lore", pool);

      expect(pool.query.mock.calls[0][0]).not.toContain("al.graph");
    });

    it("by-task rows keep the graph (the wizard draws it)", async () => {
      const pool = makePool();

      pool.query.mockResolvedValue({ rows: [] });
      await get("/api/assembly-lines?task_id=t1", pool);

      expect(pool.query.mock.calls[0][0]).toContain("al.graph");
    });

    it("the cost lateral reads llm_calls.assembly_line_id — the column that exists", async () => {
      // The telemetry tables deliberately kept the pre-rename column (0040);
      // querying the new spelling here 42703s every run read after deploy.
      const pool = makePool();

      pool.query.mockResolvedValue({ rows: [] });
      await get("/api/assembly-lines", pool);

      expect(pool.query.mock.calls[0][0]).toContain("lc.assembly_line_id");
      expect(pool.query.mock.calls[0][0]).not.toContain("lc.assembly_run_id");
    });

    it("rows carry definition_name for the pre-rename web-ui behind the alias", async () => {
      const pool = makePool();

      pool.query.mockResolvedValue({ rows: [] });
      await get("/api/assembly-lines", pool);
      await get("/api/assembly-lines?task_id=t1", pool);

      expect(pool.query.mock.calls[0][0]).toContain(
        "al.blueprint_name AS definition_name",
      );
      expect(pool.query.mock.calls[1][0]).toContain(
        "al.blueprint_name AS definition_name",
      );
    });
  });

  describe("GET /api/assembly-lines/{id}", () => {
    it("selects the graph clone and the definition_name alias", async () => {
      const pool = makePool();

      pool.query.mockResolvedValue({ rows: [{ id: "run-1" }] });
      await get("/api/assembly-lines/run-1", pool);

      expect(pool.query.mock.calls[0][0]).toContain("al.graph");
      expect(pool.query.mock.calls[0][0]).toContain(
        "al.blueprint_name AS definition_name",
      );
    });

    it("returns the run", async () => {
      const pool = makePool();

      pool.query.mockResolvedValue({ rows: [{ id: "run-1" }] });

      expect((await get("/api/assembly-lines/run-1", pool)).result).toEqual({
        id: "run-1",
      });
    });

    it("returns 404 for an id no run holds", async () => {
      const pool = makePool();

      pool.query.mockResolvedValue({ rows: [] });

      expect((await get("/api/assembly-lines/gone", pool)).statusCode).toBe(
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
      const pool = makePool();
      const nodes = [{ node_id: "analyze", iteration: 1 }];

      pool.query.mockResolvedValue({ rows: nodes });
      const res = await get("/api/assembly-lines/run-1/nodes", pool);

      expect(pool.query.mock.calls[0][0]).toContain("ORDER BY id");
      expect(res.result).toEqual({ nodes });
    });

    it("each node row carries its station_run_id — the visit's identity (FR6.39)", async () => {
      const pool = makePool();

      pool.query.mockResolvedValue({ rows: [] });
      await get("/api/assembly-lines/run-1/nodes", pool);

      expect(pool.query.mock.calls[0][0]).toContain("station_run_id");
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
