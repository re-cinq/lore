import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

describe("GET /api/tasks/{id}/runs", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  function get(id: string, pool: unknown = makePool()) {
    return buildServer(() => pool as never).inject({
      method: "GET",
      url: `/api/tasks/${id}/runs`,
      headers: AUTH,
    });
  }

  it("returns 503 when pool is null", async () => {
    const res = await get("t1", null);

    expect(res.statusCode).toBe(503);
  });

  it("returns 404 for a task that does not exist", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [] });
    const res = await get("gone", pool);

    expect(res.statusCode).toBe(404);
    expect(res.result).toEqual({ error: "Task not found" });
  });

  it("returns the task's runs newest first", async () => {
    const pool = makePool();
    const runs = [
      {
        id: "run-2",
        status: "running",
        outcome: null,
        created_at: "2026-08-14",
      },
      {
        id: "run-1",
        status: "done",
        outcome: "success",
        created_at: "2026-08-13",
      },
    ];

    pool.query
      .mockResolvedValueOnce({ rows: [{ id: "t1" }] })
      .mockResolvedValueOnce({ rows: runs });
    const res = await get("t1", pool);

    expect(res.statusCode).toBe(200);
    expect(res.result).toEqual({ runs });
  });

  it("returns an empty list when the assembly_lines table predates migration 0025", async () => {
    const pool = makePool();
    const undefinedTable = Object.assign(new Error("relation does not exist"), {
      code: "42P01",
    });

    pool.query
      .mockResolvedValueOnce({ rows: [{ id: "t1" }] })
      .mockRejectedValueOnce(undefinedTable);
    const res = await get("t1", pool);

    expect(res.statusCode).toBe(200);
    expect(res.result).toEqual({ runs: [] });
  });
});
