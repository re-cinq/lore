import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

describe("task view reads", () => {
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

  describe("GET /api/repo-tasks", () => {
    it("returns 503 when pool is null", async () => {
      expect(
        (await get("/api/repo-tasks?repo=re-cinq/lore", null)).statusCode,
      ).toBe(503);
    });

    it("returns the repo's most recent tasks", async () => {
      const pool = makePool();
      const tasks = [{ id: "t1", task_type: "review" }];

      pool.query.mockResolvedValue({ rows: tasks });
      const res = await get("/api/repo-tasks?repo=re-cinq/lore&limit=5", pool);

      expect(res.result).toEqual({ tasks });
      expect(pool.query.mock.calls[0][1]).toEqual(["re-cinq/lore", 5]);
    });

    it("requires a repo", async () => {
      expect((await get("/api/repo-tasks")).statusCode).toBe(400);
    });

    it("returns an empty list rather than 500 when the table is absent", async () => {
      const pool = makePool();

      pool.query.mockRejectedValue(
        Object.assign(new Error("nope"), { code: "42P01" }),
      );

      expect(
        (await get("/api/repo-tasks?repo=re-cinq/lore", pool)).result,
      ).toEqual({ tasks: [] });
    });
  });

  describe("GET /api/task-stats", () => {
    it("returns the org-wide totals", async () => {
      const pool = makePool();

      pool.query.mockResolvedValue({ rows: [{ total: 90, today: 4 }] });

      expect((await get("/api/task-stats", pool)).result).toEqual({
        total: 90,
        today: 4,
      });
    });
  });

  describe("GET /api/agent-activity", () => {
    it("returns the per-agent aggregates org-wide", async () => {
      const pool = makePool();
      const agents = [{ agent_id: "a1", task_count: 3 }];

      pool.query.mockResolvedValue({ rows: agents });
      const res = await get("/api/agent-activity", pool);

      expect(res.result).toEqual({ agents });
      expect(pool.query.mock.calls[0][1]).toEqual([]);
    });

    it("scopes the aggregates to a repo when one is named", async () => {
      const pool = makePool();

      pool.query.mockResolvedValue({ rows: [] });
      await get("/api/agent-activity?repo=re-cinq/lore", pool);

      expect(pool.query.mock.calls[0][0]).toContain("t.target_repo = $1");
      expect(pool.query.mock.calls[0][1]).toEqual(["re-cinq/lore"]);
    });
  });

  describe("GET /api/tasks/{id}/runtime", () => {
    it("returns the task's events and llm calls", async () => {
      const pool = makePool();

      pool.query
        .mockResolvedValueOnce({ rows: [{ to_status: "pending" }] })
        .mockResolvedValueOnce({ rows: [{ model: "claude" }] });

      expect((await get("/api/tasks/t1/runtime", pool)).result).toEqual({
        events: [{ to_status: "pending" }],
        llm_calls: [{ model: "claude" }],
      });
    });
  });

  describe("GET /api/audit-log", () => {
    it("returns a repo's entries filtered to the named event types", async () => {
      const pool = makePool();
      const entries = [{ event_type: "auto_merge_decision" }];

      pool.query.mockResolvedValue({ rows: entries });
      const res = await get(
        "/api/audit-log?repo=re-cinq/lore&event_types=auto_merge_decision,escalation_issued",
        pool,
      );

      expect(res.result).toEqual({ entries });
      expect(pool.query.mock.calls[0][1]).toEqual([
        "re-cinq/lore",
        ["auto_merge_decision", "escalation_issued"],
        25,
      ]);
    });

    it("returns an empty list rather than 500 when the table is absent", async () => {
      const pool = makePool();

      pool.query.mockRejectedValue(
        Object.assign(new Error("nope"), { code: "42P01" }),
      );

      expect(
        (await get("/api/audit-log?repo=re-cinq/lore&event_types=x", pool))
          .result,
      ).toEqual({ entries: [] });
    });
  });
});
