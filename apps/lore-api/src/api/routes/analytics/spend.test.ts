import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../../../server/build-server.js";
import {
  makePool,
  useRateLimitSafeClock,
  AUTH,
  LEGACY_TOKEN,
} from "@re-cinq/lore-server-core/test-helpers/http-mock.js";

const originalEnv = { ...process.env };

const undefinedTable = () =>
  Object.assign(new Error("no such table"), { code: "42P01" });

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

describe("GET /api/spend", () => {
  useRateLimitSafeClock();
  beforeEach(() => {
    process.env.LORE_INGEST_TOKEN = LEGACY_TOKEN;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  function get(pool: unknown = makePool()) {
    return buildServer(() => pool as never).inject({
      method: "GET",
      url: "/api/spend",
      headers: AUTH,
    });
  }

  it("returns 503 when pool is null", async () => {
    expect((await get(null)).statusCode).toBe(503);
  });

  it("carries the billed figures, the Lore-computed figures and their breakdowns", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({
      rows: [{ billed_usd: 3, as_of: "2026-08-14", cost_usd: 1 }],
    });
    const res = await get(pool);

    expect(res.statusCode).toBe(200);
    expect(res.result).toMatchObject({
      org_available: true,
      org_mtd: { billed_usd: 3 },
      lore_today_usd: 1,
    });
  });

  it("reports the org figures unavailable when the cost table is absent", async () => {
    const pool = makePool();

    // The three anthropic_cost_daily reads come first; the llm_calls reads
    // still answer, because Lore-computed spend never depends on the sync.
    pool.query
      .mockRejectedValueOnce(undefinedTable())
      .mockRejectedValueOnce(undefinedTable())
      .mockRejectedValueOnce(undefinedTable())
      .mockResolvedValue({ rows: [{ cost_usd: 2 }] });

    const res = await get(pool);

    expect(res.statusCode).toBe(200);
    expect(res.result).toMatchObject({
      org_available: false,
      org_mtd: { billed_usd: 0, as_of: null },
      org_by_model: [],
      org_daily: [],
      lore_today_usd: 2,
    });
  });

  it("reports the billed total unavailable when the sync has never run", async () => {
    const pool = makePool();

    // The table exists but holds nothing this month: no `as_of` stamp, so the
    // view must hide the billed sections rather than show a confident zero.
    pool.query.mockResolvedValue({ rows: [] });

    expect((await get(pool)).result).toMatchObject({
      org_available: false,
      org_mtd: { billed_usd: 0, as_of: null },
    });
  });

  it("scopes every figure to the month to date", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [] });
    await get(pool);

    const monthly = pool.query.mock.calls.filter(([sql]) =>
      String(sql).includes("date_trunc('month', current_date)"),
    );

    expect(monthly.length).toBe(pool.query.mock.calls.length - 1);
  });

  it("attributes run-scoped spend through llm_calls.assembly_line_id", async () => {
    // The column is deliberately NOT renamed with the run model: no compat view
    // can cover a renamed column on a table that keeps its own name, and this
    // query is what breaks when one tries — it 500s permanently on 42703, which
    // is how the attempt during the rename was found. Pinned as SQL TEXT, since
    // a mocked pool answers any column name happily.
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [] });
    await get(pool);

    const runScoped = pool.query.mock.calls.filter(([sql]) =>
      String(sql).includes("assembly_line_id"),
    );

    expect(runScoped.length).toBeGreaterThan(0);
    expect(
      pool.query.mock.calls.some(([sql]) =>
        String(sql).includes("assembly_run_id"),
      ),
    ).toBe(false);
  });
});
