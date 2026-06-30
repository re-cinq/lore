import { describe, it, expect } from "vitest";
import { startJobRun, completeJobRun, failJobRun } from "./job-run.js";
import { InMemoryJobRuns } from "@re-cinq/lore-shared/project/job-runs/job-runs-memory.js";

describe("startJobRun", () => {
  it("opens a running row and returns the run id", async () => {
    const runs = new InMemoryJobRuns();

    const runId = await startJobRun("context_reindex", runs);

    expect(runs.rows).toMatchObject([
      { id: runId, jobName: "context_reindex", status: "running" },
    ]);
  });
});

describe("completeJobRun", () => {
  it("marks the row completed with the result summary", async () => {
    const runs = new InMemoryJobRuns();
    const runId = await startJobRun("context_reindex", runs);

    await completeJobRun(runId, "linked 17 (spec,test) pairs", {}, runs);

    expect(runs.rows[0]).toMatchObject({
      status: "completed",
      resultSummary: "linked 17 (spec,test) pairs",
      logPath: null,
    });
  });

  it("persists the log_path when provided", async () => {
    const runs = new InMemoryJobRuns();
    const runId = await startJobRun("context_reindex", runs);

    await completeJobRun(runId, "ok", {
      logPath: "__job_runs__/context_reindex/run/output.log",
    }, runs);

    expect(runs.rows[0]?.logPath).toBe("__job_runs__/context_reindex/run/output.log");
  });
});

describe("failJobRun", () => {
  it("marks the row failed with the error", async () => {
    const runs = new InMemoryJobRuns();
    const runId = await startJobRun("eval_runner", runs);

    await failJobRun(runId, "ECONNREFUSED postgres:5432", {}, runs);

    expect(runs.rows[0]).toMatchObject({
      status: "failed",
      error: "ECONNREFUSED postgres:5432",
      logPath: null,
    });
  });

  it("persists the log_path when provided", async () => {
    const runs = new InMemoryJobRuns();
    const runId = await startJobRun("eval_runner", runs);

    await failJobRun(runId, "boom", {
      logPath: "__job_runs__/eval_runner/run/output.log",
    }, runs);

    expect(runs.rows[0]?.logPath).toBe("__job_runs__/eval_runner/run/output.log");
  });
});
