import { describe, it, expect } from "vitest";
import { InMemoryArchive } from "@re-cinq/lore-shared/project/archive/archive-memory.js";
import {
  jobRunLogKey,
  writeJobRunLogs,
  readJobRunLogs,
} from "./log-storage.js";

describe("jobRunLogKey", () => {
  it("returns __job_runs__/<job>/<runId>/output.log", () => {
    expect(jobRunLogKey("context_reindex", "run-abc")).toBe(
      "__job_runs__/context_reindex/run-abc/output.log",
    );
  });
});

describe("writeJobRunLogs", () => {
  it("redacts the payload and saves text/plain no-cache at the job-run key", async () => {
    const archive = new InMemoryArchive();

    await writeJobRunLogs(
      "eval_runner",
      "run-456",
      "starting up\nAUTH=sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n",
      archive,
    );

    const stored = archive.objects.get(
      "__job_runs__/eval_runner/run-456/output.log",
    );

    expect(stored?.options).toEqual({
      contentType: "text/plain",
      cacheControl: "no-cache",
    });
    expect(stored?.body).toContain("starting up");
    expect(stored?.body).not.toContain("sk-ant-api03-aaaaaaaa");
  });
});

describe("readJobRunLogs", () => {
  it("returns the stored content for the job-run key", async () => {
    const archive = new InMemoryArchive();

    await writeJobRunLogs("spec_drift", "run-789", "log line one", archive);
    expect(await readJobRunLogs("spec_drift", "run-789", archive)).toBe(
      "log line one",
    );
  });

  it("returns null when the object does not exist", async () => {
    const out = await readJobRunLogs(
      "spec_drift",
      "missing",
      new InMemoryArchive(),
    );

    expect(out).toBeNull();
  });
});
