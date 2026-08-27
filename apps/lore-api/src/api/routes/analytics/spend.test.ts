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
      rows: [
        {
          billed_usd: 3,
          as_of: "2026-08-14",
          billed_through: "2026-08-13",
          cost_usd: 1,
          days: 1,
        },
      ],
    });
    const res = await get(pool);

    expect(res.statusCode).toBe(200);
    expect(res.result).toMatchObject({
      org_available: true,
      org_mtd: { billed_usd: 3, billed_through: "2026-08-13" },
      lore_unbilled_usd: 1,
      lore_unbilled_days: 1,
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
      .mockResolvedValue({ rows: [{ cost_usd: 2, days: 3 }] });

    const res = await get(pool);

    expect(res.statusCode).toBe(200);
    expect(res.result).toMatchObject({
      org_available: false,
      org_mtd: { billed_usd: 0, as_of: null, billed_through: null },
      org_by_model: [],
      org_daily: [],
      lore_unbilled_usd: 2,
      lore_unbilled_days: 3,
    });
  });

  it("reports the billed total unavailable when the sync has never run", async () => {
    const pool = makePool();

    // The table exists but holds nothing this month: no `as_of` stamp, so the
    // view must hide the billed sections rather than show a confident zero.
    pool.query.mockResolvedValue({ rows: [] });

    expect((await get(pool)).result).toMatchObject({
      org_available: false,
      org_mtd: { billed_usd: 0, as_of: null, billed_through: null },
    });
  });

  it("scopes every month-to-date figure to the month to date", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [] });
    await get(pool);

    // Every spend statement, with no exception: the unbilled read used to be
    // the one holdout (`created_at >= current_date`), and that unbounded-below
    // shape is exactly what could not express a gap wider than today.
    //
    // The credit-ledger read is excluded by name rather than by accident. It
    // is not a month-to-date figure and must not become one: a balance added
    // last month is still money, and clipping the ledger to this month would
    // silently zero it. Its own window is pinned below, anchored to the
    // earliest entry.
    const spendReads = pool.query.mock.calls.filter(
      ([sql]) => !String(sql).includes("pipeline.credit_ledger"),
    );
    const monthly = spendReads.filter(([sql]) =>
      String(sql).includes("date_trunc('month', current_date)"),
    );

    expect(monthly.length).toBe(spendReads.length);
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

    const callsNamingColumn = pool.query.mock.calls.filter(([sql]) =>
      String(sql).includes("assembly_line_id"),
    );

    expect(callsNamingColumn.length).toBeGreaterThan(0);
    expect(
      pool.query.mock.calls.some(([sql]) =>
        String(sql).includes("assembly_run_id"),
      ),
    ).toBe(false);
  });

  it("bounds the unbilled window by the last billed day, not by today", async () => {
    // The defect this pins: `created_at >= current_date` could only ever mean
    // "today", so a sync that stopped at 8/18 left 8/19 in neither figure and
    // the card's own footnote still claimed a one-day gap.
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [{ billed_through: "2026-08-18" }] });
    await get(pool);

    const unbilled = pool.query.mock.calls.find(([sql]) =>
      String(sql).includes("$1::date"),
    );

    expect(unbilled?.[1]).toEqual(["2026-08-18"]);
  });

  it("treats the whole month as unbilled when the sync has never run", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [] });
    await get(pool);

    const unbilled = pool.query.mock.calls.find(([sql]) =>
      String(sql).includes("$1::date"),
    );

    expect(unbilled?.[1]).toEqual([null]);
  });

  it("counts the unbilled days alongside their cost", async () => {
    const pool = makePool();

    pool.query.mockResolvedValue({
      rows: [{ billed_through: "2026-08-18", cost_usd: 47.74, days: 2 }],
    });

    expect((await get(pool)).result).toMatchObject({
      lore_unbilled_usd: 47.74,
      lore_unbilled_days: 2,
    });
  });

  /**
   * Routes each read by the table it names, so a test can state what the
   * ledger, the billed table and llm_calls each answer without depending on
   * the order the handler happens to issue them in.
   */
  function poolAnswering(rowsByTable: Record<string, unknown[]>) {
    const pool = makePool();

    pool.query.mockImplementation((sql: unknown) => {
      const table = Object.keys(rowsByTable).find((name) =>
        String(sql).includes(name),
      );

      return Promise.resolve({ rows: table ? rowsByTable[table] : [] });
    });

    return pool;
  }

  it("reports no budget when no balance has ever been recorded", async () => {
    // An unrecorded balance is not a zero balance — the same reasoning that
    // makes `org_available` a stamp rather than a row count. A confident
    // "$0.00 remaining" reads as "we are out of money" when what it means is
    // "nobody has told us the number yet".
    expect((await get(poolAnswering({}))).result).toMatchObject({
      budget: null,
    });
  });

  it("reports no budget when the credit-ledger table has not been migrated yet", async () => {
    const pool = makePool();

    pool.query.mockImplementation((sql: unknown) =>
      String(sql).includes("pipeline.credit_ledger")
        ? Promise.reject(undefinedTable())
        : Promise.resolve({ rows: [] }),
    );

    const res = await get(pool);

    expect(res.statusCode).toBe(200);
    expect(res.result).toMatchObject({ budget: null });
  });

  it("reports remaining as the ledger total minus billed and unbilled spend since the anchor", async () => {
    const pool = poolAnswering({
      "pipeline.credit_ledger": [
        { ledger_total_usd: 500, anchored_at: "2026-08-01T00:00:00Z" },
      ],
      "pipeline.anthropic_cost_daily": [
        { billed_usd: 300, billed_through: "2026-08-19" },
      ],
      "pipeline.llm_calls": [{ cost_usd: 12.5 }],
    });

    expect((await get(pool)).result).toMatchObject({
      budget: {
        ledger_total_usd: 500,
        spent_since_usd: 312.5,
        remaining_usd: 187.5,
        anchored_at: "2026-08-01T00:00:00Z",
      },
    });
  });

  it("reports a negative remaining when spend has overrun the recorded balance", async () => {
    // Overspend is a real state and the most important one to show plainly.
    // Clamping it at zero would hide exactly the day someone needs to notice.
    const pool = poolAnswering({
      "pipeline.credit_ledger": [
        { ledger_total_usd: 100, anchored_at: "2026-08-01T00:00:00Z" },
      ],
      "pipeline.anthropic_cost_daily": [
        { billed_usd: 140, billed_through: "2026-08-19" },
      ],
      "pipeline.llm_calls": [{ cost_usd: 5 }],
    });

    expect((await get(pool)).result).toMatchObject({
      budget: { spent_since_usd: 145, remaining_usd: -45 },
    });
  });

  it("anchors both halves of the budget window to the earliest ledger entry", async () => {
    // The whole point of the anchor: a balance added in June is still money in
    // August, so this window must not collapse to the current month like every
    // other figure on the page.
    const pool = poolAnswering({
      "pipeline.credit_ledger": [
        { ledger_total_usd: 100, anchored_at: "2026-06-14T00:00:00Z" },
      ],
      "pipeline.anthropic_cost_daily": [{ billed_through: "2026-08-19" }],
    });

    await get(pool);

    const anchoredReadsOf = (table: string) =>
      pool.query.mock.calls.filter(
        ([sql, params]) =>
          String(sql).includes(table) &&
          Array.isArray(params) &&
          (params as unknown[]).includes("2026-06-14T00:00:00Z"),
      );

    expect(anchoredReadsOf("pipeline.anthropic_cost_daily").length).toBe(1);
    expect(anchoredReadsOf("pipeline.llm_calls").length).toBe(1);
  });

  it("counts a day past the last billed day on the computed side only", async () => {
    // The two halves meet at `billed_through` and must not overlap there:
    // billed covers up to and including it, computed starts strictly after.
    // An off-by-one either double-counts a day or drops one, and both look
    // like a plausible balance.
    const pool = poolAnswering({
      "pipeline.credit_ledger": [
        { ledger_total_usd: 100, anchored_at: "2026-08-01T00:00:00Z" },
      ],
      "pipeline.anthropic_cost_daily": [{ billed_through: "2026-08-19" }],
    });

    await get(pool);

    const computed = pool.query.mock.calls.find(
      ([sql]) =>
        String(sql).includes("pipeline.llm_calls") &&
        String(sql).includes("$2::date"),
    );

    expect(computed?.[1]).toEqual(["2026-08-01T00:00:00Z", "2026-08-19"]);
  });

  it("excludes corrections from the anchor but not from the total", async () => {
    // A correction adjusts an amount; it does not start a balance. Left in the
    // MIN, one backdated typo fix drags the anchor to its own date and counts
    // every dollar spent in between — verified against Postgres, where a
    // correction dated 6/14 moved the anchor off 8/01 by seven weeks.
    const pool = poolAnswering({});

    await get(pool);

    const ledgerRead = pool.query.mock.calls.find(([sql]) =>
      String(sql).includes("pipeline.credit_ledger"),
    );
    const sql = String(ledgerRead?.[0]);

    // The opening entry decides when counting starts; the earliest row does
    // not. Anchoring on MIN over everything let a BACKDATED top-up drag the
    // window weeks earlier and charge old spend against a new balance.
    expect(sql).toContain("MIN(effective_at) FILTER (WHERE kind = 'opening')");
    expect(sql).toContain(
      "MIN(effective_at) FILTER (WHERE kind <> 'correction')",
    );
    // The SUM stays unfiltered — a correction is still money.
    expect(sql).toContain("COALESCE(SUM(amount_usd), 0)");
    expect(sql).not.toContain("SUM(amount_usd) FILTER");
  });

  it("attributes computed spend to the cluster-agent that ran each call", async () => {
    // The differentiator the whole feature turns on: a satellite cluster's
    // spend, isolated from the home cluster's, read straight out of the join
    // llm_calls carries to its station run.
    const pool = poolAnswering({
      "pipeline.cluster_agents": [
        { cluster: "colleague-satellite", calls: 12, cost_usd: 88.5 },
        { cluster: "(central / regular)", calls: 40, cost_usd: 20 },
      ],
    });

    expect((await get(pool)).result).toMatchObject({
      lore_by_cluster: [
        { cluster: "colleague-satellite", calls: 12, cost_usd: 88.5 },
        { cluster: "(central / regular)", calls: 40, cost_usd: 20 },
      ],
    });
  });

  it("groups cluster spend through station_runs and labels the unclaimed rows", async () => {
    // Pinned as SQL text because a mocked pool answers any shape happily. A
    // call with no station run (a direct-API task) has no cluster_agent_id and
    // must fall into one honest bucket, not vanish — hence the outer LEFT JOINs
    // and the COALESCE label rather than an inner join that would drop it.
    const pool = makePool();

    pool.query.mockResolvedValue({ rows: [] });
    await get(pool);

    const clusterRead = pool.query.mock.calls.find(([sql]) =>
      String(sql).includes("pipeline.cluster_agents"),
    );
    const sql = String(clusterRead?.[0]);

    expect(sql).toContain("pipeline.station_runs");
    expect(sql).toContain("station_run_id");
    expect(sql).toContain("cluster_agent_id");
    expect(sql).toContain("date_trunc('month', current_date)");
  });

  it("still renders cluster spend empty when the registry table is absent", async () => {
    // station_runs / cluster_agents arrive with migrations; a deployment that
    // predates them must degrade to no rows, never 500 the whole page.
    const pool = makePool();

    pool.query.mockImplementation((sql: unknown) =>
      String(sql).includes("pipeline.cluster_agents")
        ? Promise.reject(undefinedTable())
        : Promise.resolve({ rows: [] }),
    );

    const res = await get(pool);

    expect(res.statusCode).toBe(200);
    expect(res.result).toMatchObject({ lore_by_cluster: [] });
  });

  it("excludes satellite-cluster spend from the balance's computed side", async () => {
    // A satellite runs on a colleague's subscription token, so its cost never
    // draws the recorded API credits and never enters the billed report either
    // — counting it against the balance would drag it negative on money this
    // account never spent. The computed half LEFT JOINs the station run and
    // keeps only calls with no cluster-agent claim (home/central and direct).
    const pool = poolAnswering({
      "pipeline.credit_ledger": [
        { ledger_total_usd: 100, anchored_at: "2026-08-01T00:00:00Z" },
      ],
      "pipeline.anthropic_cost_daily": [{ billed_through: "2026-08-19" }],
    });

    await get(pool);

    const computed = pool.query.mock.calls.find(
      ([sql]) =>
        String(sql).includes("pipeline.llm_calls") &&
        String(sql).includes("$2::date"),
    );
    const sql = String(computed?.[0]);

    expect(sql).toContain("pipeline.station_runs");
    expect(sql).toContain("cluster_agent_id IS NULL");
  });
});
