import { describe, it, expect } from "vitest";
import { InMemoryAssemblyLines } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-memory.js";
import { createDetectTickHandler, detectBranchName } from "./fan-out.js";

function fakeJobRuns() {
  const started: string[] = [];
  const failed: Array<{ runId: string; reason: string }> = [];

  return {
    started,
    failed,
    jobRuns: {
      start: async (jobName: string) => {
        started.push(jobName);

        return `jr-${started.length}`;
      },
      fail: async (runId: string, reason: string) => {
        failed.push({ runId, reason });
      },
    },
  };
}

describe("detectBranchName", () => {
  it("keys the run on definition + repo (the old lease key, now the overlap-guard key)", () => {
    expect(detectBranchName("spec-drift", "re-cinq/lore")).toBe(
      "detect/spec-drift/re-cinq/lore",
    );
  });
});

describe("createDetectTickHandler", () => {
  it("starts one spec-drift assembly line per target repo with branch, job_ref run and job_run_id", async () => {
    const assemblyLines = new InMemoryAssemblyLines();
    const listed: number[] = [];
    const { started, jobRuns } = fakeJobRuns();
    const handler = createDetectTickHandler("spec-drift", {
      assemblyLines,
      jobRuns,
      jobRef: async () => "spec_drift",
      listTargetRepos: async () => {
        listed.push(1);

        return ["re-cinq/lore", "re-cinq/other"];
      },
    });

    await handler({});

    expect(listed).toHaveLength(1);
    // The job_run is pre-created here (the walk closes it via args.job_run_id)
    // and the branch reproduces the old lease key for the overlap guard.
    expect(started).toEqual([
      "spec_drift:re-cinq/lore",
      "spec_drift:re-cinq/other",
    ]);
    expect(
      assemblyLines.rows.map((r) => ({
        definitionName: r.definitionName,
        repo: r.repo,
        branch: r.branch,
        args: r.args,
      })),
    ).toEqual([
      {
        definitionName: "spec-drift",
        repo: "re-cinq/lore",
        branch: "detect/spec-drift/re-cinq/lore",
        args: { job_run_id: "jr-1" },
      },
      {
        definitionName: "spec-drift",
        repo: "re-cinq/other",
        branch: "detect/spec-drift/re-cinq/other",
        args: { job_run_id: "jr-2" },
      },
    ]);
  });

  it("params.repo restricts the fan-out to that repo without enumerating", async () => {
    const assemblyLines = new InMemoryAssemblyLines();
    const { jobRuns } = fakeJobRuns();
    const handler = createDetectTickHandler("gap-detect", {
      assemblyLines,
      jobRuns,
      jobRef: async () => "gap_detection",
      listTargetRepos: async () => {
        throw new Error("must not enumerate on a single-repo tick");
      },
    });

    await handler({ repo: "re-cinq/lore" });

    expect(assemblyLines.rows).toEqual([
      expect.objectContaining({
        definitionName: "gap-detect",
        repo: "re-cinq/lore",
        branch: "detect/gap-detect/re-cinq/lore",
      }),
    ]);
  });

  it("no target repos starts nothing", async () => {
    const assemblyLines = new InMemoryAssemblyLines();
    const { started, jobRuns } = fakeJobRuns();
    const handler = createDetectTickHandler("spec-coverage-validate", {
      assemblyLines,
      jobRuns,
      jobRef: async () => "spec_coverage_validate",
      listTargetRepos: async () => [],
    });

    await handler({});

    expect(assemblyLines.rows).toEqual([]);
    expect(started).toEqual([]);
  });

  it("fails the just-created job_run when assemblyLines.start throws before rethrowing", async () => {
    const { started, failed, jobRuns } = fakeJobRuns();
    const handler = createDetectTickHandler("spec-drift", {
      assemblyLines: {
        start: async () => {
          throw new Error("db down");
        },
      } as never,
      jobRuns,
      jobRef: async () => "spec_drift",
      listTargetRepos: async () => ["re-cinq/lore"],
    });

    await expect(handler({})).rejects.toThrow("db down");
    expect(started).toEqual(["spec_drift:re-cinq/lore"]);
    // the orphaned job_run is failed, not left running forever.
    expect(failed).toEqual([
      { runId: "jr-1", reason: expect.stringContaining("db down") },
    ]);
  });
});
