import { describe, it, expect, vi } from "vitest";

// Batch jobs migrated to K8s CronJobs per spec
// scheduled-job-runtime-split (classification table). The dispatch
// table must expose exactly these names; the runner's CLI argv
// is matched against this map.
//
// The detection family (gap_detection / spec_drift / spec_coverage_*) left the
// table with the ADR-019 amendment: their cron ticks fan out per-repo
// assembly-line runs instead of a CronJob pod.
//
// memory_ttl (#1351), importance_decay (#1350) and anthropic_cost_sync (#1348)
// left it too: a single data operation needs none of the Floor's three
// exclusive powers, so a courier CronJob posts /api/maintenance/<job> and
// lore-api runs it. What remains is the line-shaped work.
const EXPECTED_JOBS = [
  "context_reindex",
  "eval_runner",
  "context_core_builder",
  "consolidation",
];

vi.mock("../kernel/db.js", () => ({
  query: vi.fn(),
  initPool: vi.fn(),
  getPool: vi.fn(() => ({ query: vi.fn() })),
}));
vi.mock("../main-loop/scheduling/job-run.js", () => ({
  startJobRun: vi.fn().mockResolvedValue("run-1"),
  completeJobRun: vi.fn(),
  failJobRun: vi.fn(),
}));
vi.mock("../main-loop/scheduling/log-storage.js", () => ({
  jobRunLogKey: vi.fn(() => "logs/key"),
  writeJobRunLogs: vi.fn(),
}));
import { dispatch, resolveJob, runJobByName } from "./job-runner.js";

describe("dispatch map", () => {
  it.each(EXPECTED_JOBS)("resolves %s to a handler function", (name) => {
    const handler = dispatch[name];

    expect(typeof handler).toBe("function");
  });

  it("exposes exactly the 4 batch jobs (no extras, no gaps)", () => {
    expect(Object.keys(dispatch).sort()).toEqual([...EXPECTED_JOBS].sort());
  });
});

describe("resolveJob", () => {
  it("returns the handler for a known name", () => {
    expect(resolveJob("context_reindex")).toBe(dispatch.context_reindex);
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

describe("chart ↔ dispatch drift", () => {
  // Nothing tied the Helm chart's job names to the dispatch map, so they drifted:
  // `autoresearch` kept a weekly CronJob for months after its handler was gone,
  // scheduling a pod that pulled the image and exited on "Unknown job" (#1379).
  // A chart entry naming a job the runner cannot resolve is a scheduled failure.
  const chartPath = new URL(
    "../../../../infra/terraform/modules/gke-mcp/lore-platform/charts/floor-helm/values.yaml",
    import.meta.url,
  );

  it("resolves every cronJobs[].job in the chart against the dispatch map", async () => {
    const { readFileSync } = await import("node:fs");
    const { parse } = await import("yaml");
    const values = parse(readFileSync(chartPath, "utf8")) as {
      cronJobs?: { name: string; job: string }[];
    };
    const declared = (values.cronJobs ?? []).map((c) => c.job);

    expect(declared.filter((job) => resolveJob(job) === null)).toEqual([]);
  });

  it("declares a chart CronJob for every dispatch entry", async () => {
    const { readFileSync } = await import("node:fs");
    const { parse } = await import("yaml");
    const values = parse(readFileSync(chartPath, "utf8")) as {
      cronJobs?: { name: string; job: string }[];
    };
    const declared = new Set((values.cronJobs ?? []).map((c) => c.job));

    expect(Object.keys(dispatch).filter((job) => !declared.has(job))).toEqual(
      [],
    );
  });
});
