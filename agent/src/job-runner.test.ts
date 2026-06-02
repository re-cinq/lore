import { describe, it, expect, vi } from "vitest";

// The 10 batch jobs migrated to K8s CronJobs per spec
// scheduled-job-runtime-split (classification table). The dispatch
// table must expose exactly these names; the runner's CLI argv
// is matched against this map.
const EXPECTED_JOBS = [
  "context_reindex",
  "eval_runner",
  "context_core_builder",
  "importance_decay",
  "consolidation",
  "autoresearch",
  "gap_detection",
  "spec_drift",
  "spec_test_linker",
  "memory_ttl",
];

vi.mock("./db.js", () => ({
  query: vi.fn(),
  initPool: vi.fn(),
}));

import { dispatch, resolveJob } from "./job-runner.js";

describe("dispatch map", () => {
  it.each(EXPECTED_JOBS)("resolves %s to a handler function", (name) => {
    const handler = dispatch[name];
    expect(typeof handler).toBe("function");
  });

  it("exposes exactly the 10 batch jobs (no extras, no gaps)", () => {
    expect(Object.keys(dispatch).sort()).toEqual([...EXPECTED_JOBS].sort());
  });
});

describe("resolveJob", () => {
  it("returns the handler for a known name", () => {
    expect(resolveJob("spec_test_linker")).toBe(dispatch.spec_test_linker);
  });

  it("returns null for an unknown name", () => {
    expect(resolveJob("nope")).toBeNull();
    expect(resolveJob("")).toBeNull();
  });
});
