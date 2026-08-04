import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const lastRun =
  vi.fn<(jobName: string) => Promise<{ startedAt: Date } | null>>();
const startJobRun = vi.fn<(jobName: string) => Promise<string>>();
const completeJobRun =
  vi.fn<(runId: string, summary: string) => Promise<void>>();
const failJobRun = vi.fn<(runId: string, error: string) => Promise<void>>();

vi.mock("../../kernel/queues.js", () => ({
  jobRuns: () => ({ lastRun: (jobName: string) => lastRun(jobName) }),
}));

vi.mock("./job-run.js", () => ({
  startJobRun: (jobName: string) => startJobRun(jobName),
  completeJobRun: (runId: string, summary: string) =>
    completeJobRun(runId, summary),
  failJobRun: (runId: string, error: string) => failJobRun(runId, error),
}));

async function loadScheduler() {
  vi.resetModules();

  return await import("./scheduler.js");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
  lastRun.mockReset().mockResolvedValue(null);
  startJobRun.mockReset().mockResolvedValue("run-1");
  completeJobRun.mockReset().mockResolvedValue(undefined);
  failJobRun.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("runJob via startScheduler", () => {
  it("runs the job again on the next tick after startJobRun rejects", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    startJobRun
      .mockRejectedValueOnce(new Error("connection refused"))
      .mockResolvedValue("run-2");
    const handler = vi.fn<() => Promise<string>>().mockResolvedValue("done");
    const { registerJob, startScheduler } = await loadScheduler();

    registerJob("context_reindex", "* * * * *", handler);
    await startScheduler();

    expect(handler).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      "[scheduler] Failed to start run for context_reindex:",
      new Error("connection refused"),
    );

    await vi.advanceTimersByTimeAsync(30_000);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(completeJobRun).toHaveBeenCalledWith("run-2", "done");
  });

  it("does not call failJobRun when startJobRun itself rejects", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    startJobRun.mockRejectedValue(new Error("pool exhausted"));
    const handler = vi.fn<() => Promise<string>>().mockResolvedValue("done");
    const { registerJob, startScheduler } = await loadScheduler();

    registerJob("eval_runner", "* * * * *", handler);
    await startScheduler();

    expect(startJobRun).toHaveBeenCalledWith("eval_runner");
    expect(failJobRun).not.toHaveBeenCalled();
  });

  it("passes the handler failure to failJobRun and leaves the job re-eligible", async () => {
    const handler = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(new Error("boom"));
    const { registerJob, startScheduler } = await loadScheduler();

    registerJob("memory_ttl", "* * * * *", handler);
    await startScheduler();

    expect(failJobRun).toHaveBeenCalledWith("run-1", "boom");

    await vi.advanceTimersByTimeAsync(30_000);

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("completes the run with the handler result on success", async () => {
    const handler = vi
      .fn<() => Promise<string>>()
      .mockResolvedValue("linked 17 pairs");
    const { registerJob, startScheduler } = await loadScheduler();

    registerJob("context_reindex", "* * * * *", handler);
    await startScheduler();

    expect(startJobRun).toHaveBeenCalledWith("context_reindex");
    expect(completeJobRun).toHaveBeenCalledWith("run-1", "linked 17 pairs");
    expect(failJobRun).not.toHaveBeenCalled();
  });
});

describe("getJobStatus", () => {
  it("reports idle with the attempt timestamp after a failed start", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    startJobRun.mockRejectedValue(new Error("connection refused"));
    const handler = vi.fn<() => Promise<string>>().mockResolvedValue("done");
    const { registerJob, startScheduler, getJobStatus } = await loadScheduler();

    registerJob("eval_runner", "* * * * *", handler);
    await startScheduler();

    expect(getJobStatus().eval_runner).toMatchObject({
      status: "idle",
      lastRun: new Date().toISOString(),
    });
  });

  it("reports a null lastRun for a job that never ran", async () => {
    const { registerJob, getJobStatus } = await loadScheduler();

    registerJob(
      "eval_runner",
      "0 0 1 1 *",
      vi.fn<() => Promise<string>>().mockResolvedValue("done"),
    );

    expect(getJobStatus().eval_runner).toMatchObject({
      status: "idle",
      lastRun: null,
    });
  });
});
