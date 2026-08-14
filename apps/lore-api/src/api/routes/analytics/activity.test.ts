import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

describe("activity reads", () => {
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

  describe("GET /api/memory-audit", () => {
    it("returns 503 when pool is null", async () => {
      expect((await get("/api/memory-audit", null)).statusCode).toBe(503);
    });

    it("returns the page and the unpaged total", async () => {
      const pool = makePool();
      const entries = [{ id: "a1", operation: "write" }];

      pool.query
        .mockResolvedValueOnce({ rows: [{ count: 137 }] })
        .mockResolvedValueOnce({ rows: entries });

      expect((await get("/api/memory-audit", pool)).result).toEqual({
        entries,
        total: 137,
      });
    });

    it("filters by agent and operation as bound parameters", async () => {
      const pool = makePool();

      pool.query.mockResolvedValue({ rows: [{ count: 0 }] });
      await get("/api/memory-audit?agent=klaus&operation=search", pool);

      expect(pool.query.mock.calls[0][0]).toContain("agent_id = $1");
      expect(pool.query.mock.calls[0][0]).toContain("operation = $2");
      expect(pool.query.mock.calls[0][1]).toEqual(["klaus", "search"]);
    });

    it("applies no WHERE clause when neither filter is given", async () => {
      const pool = makePool();

      pool.query.mockResolvedValue({ rows: [{ count: 0 }] });
      await get("/api/memory-audit", pool);

      expect(pool.query.mock.calls[0][0]).not.toContain("WHERE");
      expect(pool.query.mock.calls[0][1]).toEqual([]);
    });

    it("filters zero-result searches for the gap view", async () => {
      const pool = makePool();

      pool.query.mockResolvedValue({ rows: [{ count: 0 }] });
      await get("/api/memory-audit?operation=search&zero_results=true", pool);

      expect(pool.query.mock.calls[0][0]).toContain(
        "metadata->>'result_count' = '0'",
      );
    });
  });

  describe("GET /api/events", () => {
    it("returns the repo's events newest first", async () => {
      const pool = makePool();
      const events = [{ id: "e1", event_name: "github.pull_request" }];

      pool.query.mockResolvedValue({ rows: events });
      const res = await get("/api/events?repo=re-cinq/lore&limit=10", pool);

      expect(res.result).toEqual({ events });
      expect(pool.query.mock.calls[0][1]).toEqual(["re-cinq/lore", 10, 0]);
    });

    it("requires a repo", async () => {
      expect((await get("/api/events")).statusCode).toBe(400);
    });

    it("returns an empty list rather than 500 when the table is absent", async () => {
      const pool = makePool();

      pool.query.mockRejectedValue(
        Object.assign(new Error("nope"), { code: "42P01" }),
      );

      expect((await get("/api/events?repo=re-cinq/lore", pool)).result).toEqual(
        { events: [] },
      );
    });
  });

  describe("GET /api/job-runs/{id}", () => {
    it("returns the run", async () => {
      const pool = makePool();

      pool.query.mockResolvedValue({
        rows: [{ id: "j1", job_name: "reindex" }],
      });

      expect((await get("/api/job-runs/j1", pool)).result).toEqual({
        id: "j1",
        job_name: "reindex",
      });
    });

    it("returns 404 for an id no run holds", async () => {
      const pool = makePool();

      pool.query.mockResolvedValue({ rows: [] });

      expect((await get("/api/job-runs/gone", pool)).statusCode).toBe(404);
    });
  });

  describe("GET /api/repos/{owner}/{repo}/activity-counts", () => {
    it("returns the repo's 7-day task, auto-merge and escalation counts", async () => {
      const pool = makePool();

      pool.query
        .mockResolvedValueOnce({ rows: [{ c: 12 }] })
        .mockResolvedValueOnce({ rows: [{ c: 5 }] })
        .mockResolvedValueOnce({ rows: [{ c: 1 }] });

      expect(
        (await get("/api/repos/re-cinq/lore/activity-counts", pool)).result,
      ).toEqual({ tasks: 12, auto_merged: 5, escalations: 1 });
    });

    it("reports a count as null rather than failing the page when its table is absent", async () => {
      const pool = makePool();

      pool.query
        .mockResolvedValueOnce({ rows: [{ c: 12 }] })
        .mockRejectedValueOnce(new Error("no audit_log"))
        .mockRejectedValueOnce(new Error("no audit_log"));

      expect(
        (await get("/api/repos/re-cinq/lore/activity-counts", pool)).result,
      ).toEqual({ tasks: 12, auto_merged: null, escalations: null });
    });
  });
});
