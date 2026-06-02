import { describe, it, expect, vi, beforeEach } from "vitest";

const saveMock = vi.fn();
const downloadMock = vi.fn();
const existsMock = vi.fn();
const fileMock = vi.fn(() => ({
  save: saveMock,
  download: downloadMock,
  exists: existsMock,
}));
const bucketMock = vi.fn(() => ({ file: fileMock }));

vi.mock("@google-cloud/storage", () => ({
  Storage: function Storage() {
    return { bucket: bucketMock };
  },
}));

import {
  jobRunLogKey,
  writeJobRunLogs,
  readJobRunLogs,
} from "./log-storage.js";

beforeEach(() => {
  saveMock.mockReset();
  downloadMock.mockReset();
  existsMock.mockReset();
  fileMock.mockClear();
  bucketMock.mockClear();
});

describe("jobRunLogKey", () => {
  it("returns __job_runs__/<job>/<runId>/output.log", () => {
    expect(jobRunLogKey("context_reindex", "run-abc")).toBe(
      "__job_runs__/context_reindex/run-abc/output.log",
    );
  });
});

describe("writeJobRunLogs", () => {
  it("redacts the payload and saves to the job-run key", async () => {
    saveMock.mockResolvedValueOnce(undefined);

    await writeJobRunLogs(
      "eval_runner",
      "run-456",
      "starting up\nAUTH=sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n",
    );

    expect(fileMock).toHaveBeenCalledWith(
      "__job_runs__/eval_runner/run-456/output.log",
    );
    const [payload] = saveMock.mock.calls[0];
    expect(payload).toContain("starting up");
    expect(payload).not.toContain("sk-ant-api03-aaaaaaaa");
  });
});

describe("readJobRunLogs", () => {
  it("returns the file contents when the object exists", async () => {
    existsMock.mockResolvedValueOnce([true]);
    downloadMock.mockResolvedValueOnce([Buffer.from("log line one\nlog line two\n")]);

    const out = await readJobRunLogs("spec_drift", "run-789");

    expect(fileMock).toHaveBeenCalledWith(
      "__job_runs__/spec_drift/run-789/output.log",
    );
    expect(out).toBe("log line one\nlog line two\n");
  });

  it("returns null when the object does not exist", async () => {
    existsMock.mockResolvedValueOnce([false]);

    const out = await readJobRunLogs("spec_drift", "missing");

    expect(out).toBeNull();
    expect(downloadMock).not.toHaveBeenCalled();
  });
});
