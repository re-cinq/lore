import { describe, it, expect } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { FileLeaseBackend } from "@re-cinq/lore-shared";
import { InMemoryAssemblyLines } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-memory.js";
import { InMemoryJobRuns } from "@re-cinq/lore-shared/project/job-runs/job-runs-memory.js";
import { runDetect } from "./run-detect.js";

async function withLeasesDir<T>(fn: (leasesDir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lore-detect-leases-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe("runDetect", () => {
  it("walks the spec-drift line for one repo: detector runs, job_runs row completed, node traced", async () => {
    await withLeasesDir(async (leasesDir) => {
      const assemblyLines = new InMemoryAssemblyLines();
      const jobRuns = new InMemoryJobRuns();
      const assemblyLineId = await assemblyLines.start({
        definitionName: "spec-drift",
        repo: "re-cinq/lore",
      });
      const detected: string[] = [];

      const result = await runDetect({
        assemblyLineId,
        definitionName: "spec-drift",
        repo: "re-cinq/lore",
        detectors: {
          spec_drift: async ({ repo }) => {
            detected.push(repo);
            return "Checked 4 specs across 1 active repos (1 drifted)";
          },
        },
        assemblyLinesPort: assemblyLines,
        jobRunsPort: jobRuns,
        leaseBackend: new FileLeaseBackend(leasesDir),
      });

      expect(result.reason).toBe("completed");
      expect(detected).toEqual(["re-cinq/lore"]);
      expect(jobRuns.rows).toEqual([
        expect.objectContaining({
          jobName: "spec_drift:re-cinq/lore",
          status: "completed",
          resultSummary: "Checked 4 specs across 1 active repos (1 drifted)",
        }),
      ]);
      expect(assemblyLines.nodes).toEqual([
        expect.objectContaining({
          assemblyLineId,
          nodeId: "detect",
          outcome: "success",
        }),
      ]);
      // Lease released after the walk.
      expect(await fs.readdir(leasesDir)).toHaveLength(0);
    });
  });

  it("acquires the branch lease with a null task id (detection runs have no pipeline task)", async () => {
    await withLeasesDir(async (leasesDir) => {
      const assemblyLines = new InMemoryAssemblyLines();
      const jobRuns = new InMemoryJobRuns();
      const backend = new FileLeaseBackend(leasesDir);
      const acquires: Array<{ branchName: string; taskId: string | null }> = [];
      const recordingBackend: typeof backend = Object.assign(
        Object.create(Object.getPrototypeOf(backend)) as typeof backend,
        backend,
        {
          acquire: (branchName: string, taskId: string | null, holder: string, ttlSec?: number) => {
            acquires.push({ branchName, taskId });
            return backend.acquire(branchName, taskId, holder, ttlSec);
          },
        },
      );
      const assemblyLineId = await assemblyLines.start({
        definitionName: "spec-drift",
        repo: "re-cinq/lore",
      });

      await runDetect({
        assemblyLineId,
        definitionName: "spec-drift",
        repo: "re-cinq/lore",
        detectors: { spec_drift: async () => "ok" },
        assemblyLinesPort: assemblyLines,
        jobRunsPort: jobRuns,
        leaseBackend: recordingBackend,
      });

      expect(acquires).toEqual([
        { branchName: "detect/spec-drift/re-cinq/lore", taskId: null },
      ]);
    });
  });

  it("marks the job_runs row failed when the detector throws", async () => {
    await withLeasesDir(async (leasesDir) => {
      const assemblyLines = new InMemoryAssemblyLines();
      const jobRuns = new InMemoryJobRuns();
      const assemblyLineId = await assemblyLines.start({
        definitionName: "gap-detect",
        repo: "re-cinq/lore",
      });

      const result = await runDetect({
        assemblyLineId,
        definitionName: "gap-detect",
        repo: "re-cinq/lore",
        detectors: {
          gap_detection: async () => {
            throw new Error("db unreachable");
          },
        },
        assemblyLinesPort: assemblyLines,
        jobRunsPort: jobRuns,
        leaseBackend: new FileLeaseBackend(leasesDir),
      });

      expect(result.reason).toBe("executor_error");
      expect(result.errorMessage).toContain("db unreachable");
      expect(jobRuns.rows).toEqual([
        expect.objectContaining({
          jobName: "gap_detection:re-cinq/lore",
          status: "failed",
          error: expect.stringContaining("db unreachable"),
        }),
      ]);
    });
  });

  it("short-circuits with lease_held when another holder has the repo's detect lease", async () => {
    await withLeasesDir(async (leasesDir) => {
      const assemblyLines = new InMemoryAssemblyLines();
      const jobRuns = new InMemoryJobRuns();
      const backend = new FileLeaseBackend(leasesDir);
      await backend.acquire("detect/spec-drift/re-cinq/lore", "other-run", "other-pod");
      const assemblyLineId = await assemblyLines.start({
        definitionName: "spec-drift",
        repo: "re-cinq/lore",
      });

      const result = await runDetect({
        assemblyLineId,
        definitionName: "spec-drift",
        repo: "re-cinq/lore",
        detectors: { spec_drift: async () => "unreached" },
        assemblyLinesPort: assemblyLines,
        jobRunsPort: jobRuns,
        leaseBackend: backend,
      });

      expect(result.reason).toBe("lease_held");
      expect(jobRuns.rows).toEqual([
        expect.objectContaining({
          jobName: "spec_drift:re-cinq/lore",
          status: "completed",
          resultSummary: expect.stringContaining("lease held"),
        }),
      ]);
    });
  });
});
