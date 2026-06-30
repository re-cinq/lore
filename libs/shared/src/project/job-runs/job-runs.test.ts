import { describe, it, expect } from "vitest";
import { PgJobRuns } from "./job-runs-pg.js";
import { InMemoryJobRuns } from "./job-runs-memory.js";
import type { PgPool } from "../../memory-store.js";

function fakePool(
  rowsByCall: unknown[][] = [],
): { pool: PgPool; calls: Array<{ text: string; params?: unknown[] }> } {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const pool: PgPool = {
    async query(text: string, params?: unknown[]) {
      calls.push({ text, params });
      return { rows: rowsByCall[calls.length - 1] ?? [] };
    },
  };
  return { pool, calls };
}

describe("PgJobRuns adapter", () => {
  it("inserts a running row and returns the new run id", async () => {
    const { pool, calls } = fakePool([[{ id: "run-7" }]]);

    const id = await new PgJobRuns(pool).start("nightly-reindex");

    expect(id).toBe("run-7");
    expect(calls[0]?.text).toContain("INSERT INTO pipeline.job_runs (job_name, status)");
    expect(calls[0]?.text).toContain("VALUES ($1, 'running') RETURNING id");
    expect(calls[0]?.params).toEqual(["nightly-reindex"]);
  });

  it("marks a run completed with summary and log path", async () => {
    const { pool, calls } = fakePool();

    await new PgJobRuns(pool).complete("run-7", "indexed 12 repos", "gs://logs/run-7");

    expect(calls[0]?.text).toContain("status = 'completed'");
    expect(calls[0]?.text).toContain("result_summary = $1");
    expect(calls[0]?.params).toEqual(["indexed 12 repos", "gs://logs/run-7", "run-7"]);
  });

  it("defaults the log path to null on complete", async () => {
    const { pool, calls } = fakePool();

    await new PgJobRuns(pool).complete("run-7", "done");

    expect(calls[0]?.params).toEqual(["done", null, "run-7"]);
  });

  it("marks a run failed with error and log path", async () => {
    const { pool, calls } = fakePool();

    await new PgJobRuns(pool).fail("run-9", "boom", "gs://logs/run-9");

    expect(calls[0]?.text).toContain("status = 'failed'");
    expect(calls[0]?.text).toContain("error = $1");
    expect(calls[0]?.params).toEqual(["boom", "gs://logs/run-9", "run-9"]);
  });

  it("selects the most-recent started_at for a job name", async () => {
    const started = new Date("2026-06-30T08:00:00Z");
    const { pool, calls } = fakePool([[{ started_at: started }]]);

    const last = await new PgJobRuns(pool).lastRun("nightly-reindex");

    expect(calls[0]?.text).toContain("SELECT started_at FROM pipeline.job_runs");
    expect(calls[0]?.text).toContain("ORDER BY started_at DESC LIMIT 1");
    expect(calls[0]?.params).toEqual(["nightly-reindex"]);
    expect(last).toEqual({ startedAt: started });
  });

  it("returns null when a job has never run", async () => {
    const { pool } = fakePool([[]]);

    expect(await new PgJobRuns(pool).lastRun("never-run")).toBeNull();
  });
});

describe("InMemoryJobRuns double", () => {
  it("seeds a running row on start and returns its id", async () => {
    const jobRuns = new InMemoryJobRuns();

    const id = await jobRuns.start("reindex");

    expect(jobRuns.rows).toMatchObject([{ id, jobName: "reindex", status: "running", completedAt: null }]);
  });

  it("closes the matching row on complete", async () => {
    const jobRuns = new InMemoryJobRuns();
    const id = await jobRuns.start("reindex");

    await jobRuns.complete(id, "done", "gs://logs/x");

    expect(jobRuns.rows[0]).toMatchObject({
      status: "completed",
      resultSummary: "done",
      logPath: "gs://logs/x",
    });
    expect(jobRuns.rows[0]?.completedAt).not.toBeNull();
  });

  it("closes the matching row on fail", async () => {
    const jobRuns = new InMemoryJobRuns();
    const id = await jobRuns.start("reindex");

    await jobRuns.fail(id, "boom");

    expect(jobRuns.rows[0]).toMatchObject({ status: "failed", error: "boom", logPath: null });
  });

  it("returns the most-recent started_at across seeded rows for a job", async () => {
    const jobRuns = new InMemoryJobRuns();
    const older = new Date("2026-06-29T00:00:00Z");
    const newer = new Date("2026-06-30T00:00:00Z");
    jobRuns.rows.push(
      { id: "a", jobName: "reindex", status: "completed", startedAt: older, completedAt: older, resultSummary: "ok", error: null, logPath: null },
      { id: "b", jobName: "reindex", status: "completed", startedAt: newer, completedAt: newer, resultSummary: "ok", error: null, logPath: null },
      { id: "c", jobName: "other", status: "completed", startedAt: newer, completedAt: newer, resultSummary: "ok", error: null, logPath: null },
    );

    expect(await jobRuns.lastRun("reindex")).toEqual({ startedAt: newer });
  });

  it("returns null when no row matches the job name", async () => {
    const jobRuns = new InMemoryJobRuns();
    await jobRuns.start("reindex");

    expect(await jobRuns.lastRun("never-run")).toBeNull();
  });
});
