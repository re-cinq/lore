import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };
const get = (pool: unknown, url = "/api/task-groups/g1") =>
  buildServer(() => pool as never).inject({
    method: "GET",
    url,
    headers: AUTH,
  });

describe("GET /api/task-groups/{id}", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns the group's tasks with a completed/total rollup", async () => {
    const rows = [
      { id: "t1", status: "merged", description: "one" },
      { id: "t2", status: "running", description: "two" },
      { id: "t3", status: "completed", description: "three" },
    ];
    const pool = makePool();

    pool.query.mockResolvedValue({ rows });
    const res = await get(pool);

    expect(res.result).toEqual({
      group_id: "g1",
      total: 3,
      completed: 2,
      tasks: rows,
    });
  });

  it("queries pipeline.tasks by task_group_id", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [] });
    await get(pool);
    const [sql, params] = pool.query.mock.calls[0];

    expect(String(sql)).toContain("task_group_id = $1");
    expect(params).toEqual(["g1"]);
  });

  it("returns an empty group rather than a 404 for an unknown id", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [] });
    const res = await get(pool);

    expect(res.result).toEqual({
      group_id: "g1",
      total: 0,
      completed: 0,
      tasks: [],
    });
  });

  it("returns 503 when the pool is null", async () => {
    const res = await get(null);

    expect(res.statusCode).toBe(503);
    expect(res.result).toEqual({ error: "database unavailable" });
  });
});
