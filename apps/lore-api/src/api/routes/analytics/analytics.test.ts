import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };
const get = (pool: unknown, url = "/api/analytics") =>
  buildServer(() => pool as never).inject({
    method: "GET",
    url,
    headers: AUTH,
  });

function analyticsPool() {
  const pool = makePool();

  pool.query
    .mockResolvedValueOnce({
      rows: [{ calls: "12", input_tokens: "900", output_tokens: "300" }],
    })
    .mockResolvedValueOnce({
      rows: [{ total: "10", succeeded: "7", failed: "2" }],
    })
    .mockResolvedValueOnce({
      rows: [{ task_type: "implementation", tasks: "6" }],
    });

  return pool;
}

describe("GET /api/analytics", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns usage, task counts and the per-type breakdown for the default month period", async () => {
    const res = await get(analyticsPool());

    expect(res.result).toEqual({
      period: "month",
      usage: { llm_calls: 12, input_tokens: 900, output_tokens: 300 },
      tasks: { total: 10, succeeded: 7, failed: 2 },
      by_type: [{ task_type: "implementation", tasks: "6" }],
    });
  });

  it("filters on the requested period", async () => {
    const pool = analyticsPool();

    await get(pool, "/api/analytics?period=today");

    expect(pool.query.mock.calls.map((c) => c[0])).toMatchObject([
      expect.stringContaining("created_at > current_date"),
      expect.stringContaining("created_at > current_date"),
      expect.stringContaining("created_at > current_date"),
    ]);
  });

  it("period=all applies no time filter", async () => {
    const pool = analyticsPool();

    await get(pool, "/api/analytics?period=all");

    expect(pool.query.mock.calls[0][0]).toContain("WHERE TRUE");
  });

  it("returns 400 for an unknown period", async () => {
    const res = await get(makePool(), "/api/analytics?period=fortnight");

    expect(res.statusCode).toBe(400);
  });

  it("returns 503 when the pool is null", async () => {
    const res = await get(null);

    expect(res.statusCode).toBe(503);
    expect(res.result).toEqual({ error: "database unavailable" });
  });
});
