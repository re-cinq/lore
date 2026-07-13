import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

function get(query = "", pool: unknown = makePool()) {
  return buildServer(() => pool as any).inject({
    method: "GET",
    url: "/api/repos" + query,
    headers: AUTH,
  });
}

describe("GET /api/repos", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns 503 when pool is null", async () => {
    const res = await get("", null);

    expect(res.statusCode).toBe(503);
  });

  it("returns repos with paging metadata, defaulting to limit 100 offset 0", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({
        rows: [{ id: 1, full_name: "re-cinq/lore", task_count: 3 }],
      })
      .mockResolvedValueOnce({ rows: [{ total: 1 }] });
    const res = await get("", pool);

    expect(res.result).toEqual({
      repos: [{ id: 1, full_name: "re-cinq/lore", task_count: 3 }],
      total: 1,
      limit: 100,
      offset: 0,
    });
    expect(pool.query.mock.calls[0][1]).toEqual([100, 0]);
  });

  it("clamps over-max limit and applies offset", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 250 }] });
    const res = await get("?limit=999&offset=100", pool);

    expect(pool.query.mock.calls[0][1]).toEqual([100, 100]);
    expect(res.result).toMatchObject({ total: 250, limit: 100, offset: 100 });
  });

  it("returns 400 for a negative offset", async () => {
    const res = await get("?offset=-5", makePool());

    expect(res.statusCode).toBe(400);
  });

  it("returns 500 when the query throws", async () => {
    const pool = makePool();

    pool.query.mockRejectedValue(new Error("boom"));
    const res = await get("", pool);

    expect(res.statusCode).toBe(500);
  });
});
