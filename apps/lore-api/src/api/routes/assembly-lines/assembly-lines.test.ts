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

    it("passes status, repo and limit to the query as bound parameters", async () => {
      const pool = makePool();

      pool.query.mockResolvedValue({ rows: [] });
      await get(
        "/api/assembly-lines?status=running&repo=re-cinq/lore&limit=5",
        pool,
      );

      expect(pool.query.mock.calls[0][1]).toEqual([
        "running",
        "re-cinq/lore",
        5,
      ]);
    });

    it("defaults an absent filter to null and the limit to 50", async () => {
      const pool = makePool();

      pool.query.mockResolvedValue({ rows: [] });
      await get("/api/assembly-lines", pool);

      expect(pool.query.mock.calls[0][1]).toEqual([null, null, 50]);
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
  });

  describe("GET /api/assembly-lines/{id}", () => {
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
