import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import { setMemoryPool } from "@re-cinq/lore-server-core/features/memory/memory.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };
const get = (pool: unknown, url = "/api/agent-stats?agent_id=agent-7") =>
  buildServer(() => pool as never).inject({
    method: "GET",
    url,
    headers: AUTH,
  });

function statsPool() {
  const pool = makePool();

  pool.query
    .mockResolvedValueOnce({
      rows: [{ memory_count: 4, last_active: null, snapshot_count: 1 }],
    })
    .mockResolvedValueOnce({ rows: [{ total_facts: 9, active_facts: 8 }] })
    .mockResolvedValueOnce({
      rows: [{ id: "e1", source: "session", fact_count: 2 }],
    })
    .mockResolvedValueOnce({ rows: [{ total: 17 }] });
  setMemoryPool(pool as never);

  return pool;
}

describe("GET /api/agent-stats", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    setMemoryPool(null);
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("merges health, stats and recent episodes into one object", async () => {
    const res = await get(statsPool());

    expect(res.result).toEqual({
      agent_id: "agent-7",
      memory_count: 4,
      last_active: null,
      snapshot_count: 1,
      total_facts: 9,
      active_facts: 8,
      recent_episodes: {
        total_count: 17,
        latest: [{ id: "e1", source: "session", fact_count: 2 }],
      },
    });
  });

  it("reports zero episodes when the episode queries fail", async () => {
    const pool = statsPool();

    pool.query
      .mockReset()
      .mockResolvedValueOnce({
        rows: [{ memory_count: 0, last_active: null, snapshot_count: 0 }],
      })
      .mockResolvedValueOnce({ rows: [{ total_facts: 0 }] })
      .mockRejectedValue(new Error("relation does not exist"));
    const res = await get(pool);

    expect(res.result).toMatchObject({
      recent_episodes: { total_count: 0, latest: [] },
    });
  });

  it("returns 503 when memory has no database", async () => {
    setMemoryPool(null);
    const res = await get(makePool());

    expect(res.statusCode).toBe(503);
    expect(res.result).toEqual({ error: "database unavailable" });
  });

  it("returns 400 when agent_id is missing", async () => {
    const res = await get(statsPool(), "/api/agent-stats");

    expect(res.statusCode).toBe(400);
  });
});
