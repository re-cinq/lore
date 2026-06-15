import { describe, it, expect, vi, beforeEach } from "vitest";
import { startJobRun, completeJobRun, failJobRun } from "./job-run.js";
import { query } from "../data/db.js";

vi.mock("../data/db.js", () => ({
  query: vi.fn(),
}));

const queryMock = query as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  queryMock.mockReset();
});

describe("startJobRun", () => {
  it("inserts a running row and returns the run id", async () => {
    queryMock.mockResolvedValueOnce([{ id: "run-123" }]);

    const runId = await startJobRun("context_reindex");

    expect(runId).toBe("run-123");
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO pipeline\.job_runs/);
    expect(sql).toMatch(/'running'/);
    expect(sql).toMatch(/RETURNING id/);
    expect(params).toEqual(["context_reindex"]);
  });
});

describe("completeJobRun", () => {
  it("updates the row with completed status and result_summary", async () => {
    queryMock.mockResolvedValueOnce([]);

    await completeJobRun("run-123", "linked 17 (spec,test) pairs");

    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/UPDATE pipeline\.job_runs/);
    expect(sql).toMatch(/status = 'completed'/);
    expect(sql).toMatch(/result_summary = \$1/);
    expect(sql).toMatch(/WHERE id = \$\d/);
    expect(params).toEqual(["linked 17 (spec,test) pairs", null, "run-123"]);
  });

  it("persists the log_path when provided", async () => {
    queryMock.mockResolvedValueOnce([]);

    await completeJobRun("run-123", "ok", {
      logPath: "__job_runs__/context_reindex/run-123/output.log",
    });

    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/log_path = \$2/);
    expect(params).toEqual([
      "ok",
      "__job_runs__/context_reindex/run-123/output.log",
      "run-123",
    ]);
  });
});

describe("failJobRun", () => {
  it("updates the row with failed status and error", async () => {
    queryMock.mockResolvedValueOnce([]);

    await failJobRun("run-456", "ECONNREFUSED postgres:5432");

    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/UPDATE pipeline\.job_runs/);
    expect(sql).toMatch(/status = 'failed'/);
    expect(sql).toMatch(/error = \$1/);
    expect(sql).toMatch(/WHERE id = \$\d/);
    expect(params).toEqual(["ECONNREFUSED postgres:5432", null, "run-456"]);
  });

  it("persists the log_path when provided", async () => {
    queryMock.mockResolvedValueOnce([]);

    await failJobRun("run-456", "boom", {
      logPath: "__job_runs__/eval_runner/run-456/output.log",
    });

    const [, params] = queryMock.mock.calls[0];
    expect(params).toEqual([
      "boom",
      "__job_runs__/eval_runner/run-456/output.log",
      "run-456",
    ]);
  });
});
