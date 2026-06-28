import { describe, it, expect, vi } from "vitest";

// Batch jobs migrated to K8s CronJobs per spec
// scheduled-job-runtime-split (classification table). The dispatch
// table must expose exactly these names; the runner's CLI argv
// is matched against this map.
//
// v3 of spec-test-coverage (2026-06-02) replaced `spec_test_linker`
// with the pair `spec_coverage_validate` (daily) + `spec_coverage_backfill`
// (weekly).
const EXPECTED_JOBS = [
  "context_reindex",
  "eval_runner",
  "context_core_builder",
  "importance_decay",
  "consolidation",
  "autoresearch",
  "gap_detection",
  "spec_drift",
  "spec_coverage_backfill",
  "spec_coverage_validate",
  "memory_ttl",
  "anthropic_cost_sync",
];

vi.mock("../kernel/db.js", () => ({
  query: vi.fn(),
  initPool: vi.fn(),
  getPool: vi.fn(() => ({ query: vi.fn() })),
}));
vi.mock("../scheduling/job-run.js", () => ({
  startJobRun: vi.fn().mockResolvedValue("run-1"),
  completeJobRun: vi.fn(),
  failJobRun: vi.fn(),
}));
vi.mock("../scheduling/log-storage.js", () => ({
  jobRunLogKey: vi.fn(() => "logs/key"),
  writeJobRunLogs: vi.fn(),
}));
import { dispatch, resolveJob, runJobByName } from "./job-runner.js";

describe("dispatch map", () => {
  it.each(EXPECTED_JOBS)("resolves %s to a handler function", (name) => {
    const handler = dispatch[name];
    expect(typeof handler).toBe("function");
  });

  it("exposes exactly the 12 batch jobs (no extras, no gaps)", () => {
    expect(Object.keys(dispatch).sort()).toEqual([...EXPECTED_JOBS].sort());
  });
});

describe("resolveJob", () => {
  it("returns the handler for a known name", () => {
    expect(resolveJob("spec_coverage_backfill")).toBe(dispatch.spec_coverage_backfill);
  });

  it("returns null for an unknown name", () => {
    expect(resolveJob("nope")).toBeNull();
    expect(resolveJob("")).toBeNull();
  });
});

describe("runJobByName", () => {
  // Jobs reach GitHub via the project facade (projectFor → createProject builds
  // its adapter from env on demand), so there is no startup platform wiring to
  // configure — the entrypoint just runs the handler and exits 0.
  it("invokes the job handler and exits 0", async () => {
    const handler = vi.fn(async () => "ok");
    dispatch.__platform_probe = handler;
    try {
      const code = await runJobByName("__platform_probe");
      expect(code).toBe(0);
      expect(handler).toHaveBeenCalledOnce();
    } finally {
      delete dispatch.__platform_probe;
    }
  });
});
