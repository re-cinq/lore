import { describe, it, expect } from "vitest";
import { PgBaseline } from "./baseline-pg.js";
import { InMemoryBaseline } from "./baseline-memory.js";
import type { PgPool } from "../../memory-store.js";

function fakePool(rows: Record<string, unknown>[] = []): {
  pool: PgPool;
  calls: Array<{ text: string; params?: unknown[] }>;
} {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const pool: PgPool = {
    async query(text: string, params?: unknown[]) {
      calls.push({ text, params });
      return { rows };
    },
  };
  return { pool, calls };
}

describe("PgBaseline adapter", () => {
  it("inserts a snapshot row, serializing counters to JSON", async () => {
    const { pool, calls } = fakePool();
    const windowStart = new Date("2026-05-01T00:00:00Z");
    const windowEnd = new Date("2026-05-31T00:00:00Z");

    await new PgBaseline(pool).insert({
      repo: "octo/repo",
      window_start: windowStart,
      window_end: windowEnd,
      counters: { issues_count: 4, median_ttm_hours: 6.5 },
    });

    expect(calls[0]?.text).toContain("INSERT INTO pipeline.dark_factory_baseline");
    expect(calls[0]?.params).toEqual([
      "octo/repo",
      windowStart,
      windowEnd,
      JSON.stringify({ issues_count: 4, median_ttm_hours: 6.5 }),
    ]);
  });

  it("reads windowed counters from pipeline.tasks", async () => {
    const { pool, calls } = fakePool([{ issues_count: "4", median_ttm: "6.5" }]);
    const windowStart = new Date("2026-05-01T00:00:00Z");
    const windowEnd = new Date("2026-05-31T00:00:00Z");

    const stats = await new PgBaseline(pool).baselineStats("octo/repo", windowStart, windowEnd);

    expect(calls[0]?.text).toContain("FROM pipeline.tasks");
    expect(calls[0]?.params).toEqual(["octo/repo", windowStart, windowEnd]);
    expect(stats).toEqual({ issues_count: 4, median_ttm_hours: 6.5 });
  });

  it("defaults an empty result to zero issues and null median", async () => {
    const { pool } = fakePool([]);

    const stats = await new PgBaseline(pool).baselineStats(
      "octo/repo",
      new Date("2026-05-01T00:00:00Z"),
      new Date("2026-05-31T00:00:00Z"),
    );

    expect(stats).toEqual({ issues_count: 0, median_ttm_hours: null });
  });
});

describe("InMemoryBaseline double", () => {
  it("keeps every inserted snapshot row", async () => {
    const baseline = new InMemoryBaseline();
    const row = {
      repo: "octo/repo",
      window_start: new Date("2026-05-01T00:00:00Z"),
      window_end: new Date("2026-05-31T00:00:00Z"),
      counters: { issues_count: 1 },
    };

    await baseline.insert(row);

    expect(baseline.rows).toEqual([row]);
  });

  it("counts PR-producing tasks and the median time-to-merge in the window", async () => {
    const windowStart = new Date("2026-05-01T00:00:00Z");
    const windowEnd = new Date("2026-05-31T00:00:00Z");
    const baseline = new InMemoryBaseline([
      {
        target_repo: "octo/repo",
        created_at: new Date("2026-05-02T00:00:00Z"),
        updated_at: new Date("2026-05-02T02:00:00Z"),
        pr_url: "https://github.com/octo/repo/pull/1",
      },
      {
        target_repo: "octo/repo",
        created_at: new Date("2026-05-03T00:00:00Z"),
        updated_at: new Date("2026-05-03T06:00:00Z"),
        pr_url: "https://github.com/octo/repo/pull/2",
      },
      {
        target_repo: "octo/repo",
        created_at: new Date("2026-05-04T00:00:00Z"),
        updated_at: new Date("2026-05-04T01:00:00Z"),
        pr_url: null,
      },
    ]);

    const stats = await baseline.baselineStats("octo/repo", windowStart, windowEnd);

    expect(stats).toEqual({ issues_count: 2, median_ttm_hours: 2 });
  });

  it("excludes tasks for other repos and outside the window", async () => {
    const windowStart = new Date("2026-05-01T00:00:00Z");
    const windowEnd = new Date("2026-05-31T00:00:00Z");
    const baseline = new InMemoryBaseline([
      {
        target_repo: "other/repo",
        created_at: new Date("2026-05-02T00:00:00Z"),
        updated_at: new Date("2026-05-02T02:00:00Z"),
        pr_url: "https://github.com/other/repo/pull/1",
      },
      {
        target_repo: "octo/repo",
        created_at: new Date("2026-04-15T00:00:00Z"),
        updated_at: new Date("2026-04-15T02:00:00Z"),
        pr_url: "https://github.com/octo/repo/pull/9",
      },
    ]);

    const stats = await baseline.baselineStats("octo/repo", windowStart, windowEnd);

    expect(stats).toEqual({ issues_count: 0, median_ttm_hours: null });
  });
});
