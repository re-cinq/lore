import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

describe("GET /api/analytics-overview", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  function overview(pool: unknown = makePool()) {
    return buildServer(() => pool as never).inject({
      method: "GET",
      url: "/api/analytics-overview",
      headers: AUTH,
    });
  }

  it("returns 503 when pool is null", async () => {
    expect((await overview(null)).statusCode).toBe(503);
  });

  it("carries the task summary and every usage breakdown", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [{ total: 7 }] });

    expect((await overview(pool)).result).toMatchObject({
      task_summary: { total: 7 },
      usage_by_task_type: [{ total: 7 }],
      job_runs: [{ total: 7 }],
    });
  });

  it("reports a null task summary when the table holds nothing", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [] });

    expect((await overview(pool)).result).toMatchObject({
      task_summary: null,
      usage_by_repo: [],
    });
  });
});
