import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../app/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };
const get = (pool: unknown, url = "/api/repos/re-cinq/lore/auto-merge/kpis") =>
  buildServer(() => pool as any).inject({ method: "GET", url, headers: AUTH });

describe("GET /api/repos/{owner}/{repo}/auto-merge/kpis", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns 503 when pool is null", async () => {
    const res = await get(null);
    expect(res.statusCode).toBe(503);
  });

  it("returns 200 with auto-merge KPIs from the view", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({
      rows: [
        {
          task_group_id: "tg1",
          pr_number: 101,
          merged_without_human: true,
          dependent_merged_before_dependency: false,
          sensitive_merged_without_codeowner: false,
        },
      ],
    });

    const res = await get(pool);

    expect(res.statusCode).toBe(200);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("pipeline.v_auto_merge_kpis"),
      expect.arrayContaining(["re-cinq/lore"]),
    );
    expect(res.result).toEqual({
      kpis: [
        {
          task_group_id: "tg1",
          pr_number: 101,
          merged_without_human: true,
          dependent_merged_before_dependency: false,
          sensitive_merged_without_codeowner: false,
        },
      ],
    });
  });
});
