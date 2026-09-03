import { describe, it, expect, vi } from "vitest";

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

  it("exposes exactly the 4 batch jobs left after detection (ADR-019) and single-op jobs (#1348-1351) moved off K8s CronJobs", () => {
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
  it("invokes the job handler and exits 0, with no startup platform wiring since GitHub access comes from the project facade on demand", async () => {
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

describe("chart ↔ dispatch drift (a chart entry naming an unresolvable job scheduled a failing pod for months, #1379)", () => {
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
