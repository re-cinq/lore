import { describe, it, expect } from "vitest";
import { PgEvalRuns } from "./evals-pg.js";
import { InMemoryEvalRuns } from "./evals-memory.js";
import type { PgPool } from "../../memory-store.js";

function fakePool(rows: Array<{ pass_rate: number }> = []): {
  pool: PgPool;
  calls: Array<{ text: string; params?: unknown[] }>;
} {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const pool: PgPool = {
    async query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }> {
      calls.push({ text, params });

      return { rows: rows as T[] };
    },
  };

  return { pool, calls };
}

describe("PgEvalRuns adapter", () => {
  it("inserts an eval_runs row with team, pass_rate, total_tests, passed, failed", async () => {
    const { pool, calls } = fakePool();

    await new PgEvalRuns(pool).record({
      team: "platform",
      pass_rate: 0.92,
      total_tests: 50,
      passed: 46,
      failed: 4,
    });

    expect(calls[0]?.text).toContain("INSERT INTO pipeline.eval_runs");
    expect(calls[0]?.params).toEqual(["platform", 0.92, 50, 46, 4]);
  });

  it("reads the latest pass_rate ordered by run_at desc with offset 0", async () => {
    const { pool, calls } = fakePool([{ pass_rate: 0.81 }]);

    const samples = await new PgEvalRuns(pool).recent("platform", 1);

    expect(calls[0]?.text).toContain("ORDER BY run_at DESC");
    expect(calls[0]?.params).toEqual(["platform", 0, 1]);
    expect(samples).toEqual([{ pass_rate: 0.81 }]);
  });

  it("reads the previous run with offset 1 limit 1 for the regression check", async () => {
    const { pool, calls } = fakePool([{ pass_rate: 0.7 }]);

    const samples = await new PgEvalRuns(pool).recent("platform", 1, 1);

    expect(calls[0]?.params).toEqual(["platform", 1, 1]);
    expect(samples).toEqual([{ pass_rate: 0.7 }]);
  });
});

describe("InMemoryEvalRuns double", () => {
  it("keeps recorded runs for assertion", async () => {
    const evals = new InMemoryEvalRuns();

    await evals.record({
      team: "platform",
      pass_rate: 0.9,
      total_tests: 10,
      passed: 9,
      failed: 1,
    });

    expect(evals.runs).toEqual([
      {
        team: "platform",
        pass_rate: 0.9,
        total_tests: 10,
        passed: 9,
        failed: 1,
      },
    ]);
  });

  it("returns the latest run for a team newest-first", async () => {
    const evals = new InMemoryEvalRuns();

    await evals.record({
      team: "platform",
      pass_rate: 0.6,
      total_tests: 10,
      passed: 6,
      failed: 4,
    });
    await evals.record({
      team: "platform",
      pass_rate: 0.8,
      total_tests: 10,
      passed: 8,
      failed: 2,
    });

    expect(await evals.recent("platform", 1)).toEqual([{ pass_rate: 0.8 }]);
  });

  it("returns the previous run with offset 1 for the regression check", async () => {
    const evals = new InMemoryEvalRuns();

    await evals.record({
      team: "platform",
      pass_rate: 0.6,
      total_tests: 10,
      passed: 6,
      failed: 4,
    });
    await evals.record({
      team: "platform",
      pass_rate: 0.8,
      total_tests: 10,
      passed: 8,
      failed: 2,
    });

    expect(await evals.recent("platform", 1, 1)).toEqual([{ pass_rate: 0.6 }]);
  });

  it("scopes recent reads to the requested team", async () => {
    const evals = new InMemoryEvalRuns();

    await evals.record({
      team: "platform",
      pass_rate: 0.9,
      total_tests: 10,
      passed: 9,
      failed: 1,
    });
    await evals.record({
      team: "web",
      pass_rate: 0.5,
      total_tests: 10,
      passed: 5,
      failed: 5,
    });

    expect(await evals.recent("web", 5)).toEqual([{ pass_rate: 0.5 }]);
  });
});
