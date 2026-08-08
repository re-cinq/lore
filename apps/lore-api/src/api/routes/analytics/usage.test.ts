import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };
const get = (pool: unknown, url = "/api/usage?agent_id=dev@example.com") =>
  buildServer(() => pool as never).inject({ method: "GET", url, headers: AUTH });

describe("GET /api/usage", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns per-period task and token totals for the agent", async () => {
    const pool = makePool();

    pool.query
      .mockResolvedValueOnce({
        rows: [{ tasks: 2, input_tokens: "100", output_tokens: "50" }],
      })
      .mockResolvedValueOnce({
        rows: [{ tasks: 9, input_tokens: "900", output_tokens: "450" }],
      })
      .mockResolvedValueOnce({
        rows: [{ tasks: 30, input_tokens: "3000", output_tokens: "1500" }],
      });
    const res = await get(pool);

    expect(res.result).toEqual({
      agent_id: "dev@example.com",
      usage: {
        today: { tasks: 2, input_tokens: 100, output_tokens: 50 },
        "7_day": { tasks: 9, input_tokens: 900, output_tokens: 450 },
        "30_day": { tasks: 30, input_tokens: 3000, output_tokens: 1500 },
      },
    });
  });

  it("queries each period with the agent id and its 8-char LIKE prefix", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({
      rows: [{ tasks: 0, input_tokens: "0", output_tokens: "0" }],
    });
    await get(pool, "/api/usage?agent_id=agent-12345678-abcd");

    expect(pool.query.mock.calls.map((c) => c[1])).toEqual([
      ["agent-12345678-abcd", "%agent-12%"],
      ["agent-12345678-abcd", "%agent-12%"],
      ["agent-12345678-abcd", "%agent-12%"],
    ]);
    expect(pool.query.mock.calls.map((c) => c[0])).toMatchObject([
      expect.stringContaining("t.created_at > current_date"),
      expect.stringContaining("interval '7 days'"),
      expect.stringContaining("interval '30 days'"),
    ]);
  });

  it("returns 400 when agent_id is missing", async () => {
    const res = await get(makePool(), "/api/usage");

    expect(res.statusCode).toBe(400);
  });

  it("returns 503 when the pool is null", async () => {
    const res = await get(null);

    expect(res.statusCode).toBe(503);
    expect(res.result).toEqual({ error: "database unavailable" });
  });
});
