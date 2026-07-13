import { describe, it, expect } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { FileLeaseBackend } from "@re-cinq/lore-shared";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import type { AgentNodeStatus } from "@re-cinq/lore-assembly-lines";
import { InMemoryAssemblyLines } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-memory.js";
import { InMemoryJobRuns } from "@re-cinq/lore-shared/project/job-runs/job-runs-memory.js";
import { runDetect, type DetectStationDispatch } from "./run-detect.js";

async function withLeasesDir<T>(
  fn: (leasesDir: string) => Promise<T>,
): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "lore-detect-leases-"));

  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** A dispatch that records launches and returns a fixed terminal status on poll. */
function fakeDispatch(status: AgentNodeStatus): {
  dispatch: DetectStationDispatch;
  launched: LoreTaskSpec[];
} {
  const launched: LoreTaskSpec[] = [];

  return {
    launched,
    dispatch: {
      launch: async (spec) => void launched.push(spec),
      status: async () => status,
    },
  };
}

const succeeded = (summary: string): AgentNodeStatus => ({
  phase: "Succeeded",
  output: `logs\nLORE_NODE_RESULT: ${JSON.stringify({ outcome: "success", extras: { "Lore-Detect-Summary": summary } })}`,
});

describe("runDetect", () => {
  it("dispatches the detect node as a station CR, completes the job_runs row, traces the node", async () => {
    await withLeasesDir(async (leasesDir) => {
      const assemblyLines = new InMemoryAssemblyLines();
      const jobRuns = new InMemoryJobRuns();
      const { dispatch, launched } = fakeDispatch(
        succeeded("Checked 4 specs (1 drifted)"),
      );
      const assemblyLineId = await assemblyLines.start({
        definitionName: "spec-drift",
        repo: "re-cinq/lore",
      });

      const result = await runDetect({
        assemblyLineId,
        definitionName: "spec-drift",
        repo: "re-cinq/lore",
        dispatch,
        assemblyLinesPort: assemblyLines,
        jobRunsPort: jobRuns,
        leaseBackend: new FileLeaseBackend(leasesDir),
      });

      expect(result.reason).toBe("completed");
      // The station CR carries def-detect + the node's job_ref in station_input.
      expect(launched[0]).toMatchObject({
        stationRef: "def-detect",
        targetRepo: "re-cinq/lore",
      });
      expect(JSON.parse(launched[0].parameters!.station_input)).toMatchObject({
        node_type: "detect",
        repo: "re-cinq/lore",
        params: { job_ref: "spec_drift" },
      });
      expect(jobRuns.rows).toEqual([
        expect.objectContaining({
          jobName: "spec_drift:re-cinq/lore",
          status: "completed",
        }),
      ]);
      expect(assemblyLines.nodes).toEqual([
        expect.objectContaining({
          assemblyLineId,
          nodeId: "detect",
          outcome: "success",
        }),
      ]);
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
          acquire: (
            branchName: string,
            taskId: string | null,
            holder: string,
            ttlSec?: number,
          ) => {
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
        dispatch: fakeDispatch(succeeded("ok")).dispatch,
        assemblyLinesPort: assemblyLines,
        jobRunsPort: jobRuns,
        leaseBackend: recordingBackend,
      });

      expect(acquires).toEqual([
        { branchName: "detect/spec-drift/re-cinq/lore", taskId: null },
      ]);
    });
  });

  it("marks the job_runs row failed when the station CR fails", async () => {
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
        dispatch: fakeDispatch({
          phase: "Failed",
          failureReason: "pod OOMKilled",
        }).dispatch,
        assemblyLinesPort: assemblyLines,
        jobRunsPort: jobRuns,
        leaseBackend: new FileLeaseBackend(leasesDir),
      });

      // A Failed CR → node outcome "failed"; the detect→done edge is on:success only,
      // so the walk aborts with executor_error and the job_runs row fails.
      expect(result.reason).toBe("executor_error");
      expect(jobRuns.rows[0]).toMatchObject({
        jobName: "gap_detection:re-cinq/lore",
        status: "failed",
      });
    });
  });

  it("short-circuits with lease_held when another holder has the repo's detect lease", async () => {
    await withLeasesDir(async (leasesDir) => {
      const assemblyLines = new InMemoryAssemblyLines();
      const jobRuns = new InMemoryJobRuns();
      const backend = new FileLeaseBackend(leasesDir);

      await backend.acquire(
        "detect/spec-drift/re-cinq/lore",
        "other-run",
        "other-pod",
      );
      const assemblyLineId = await assemblyLines.start({
        definitionName: "spec-drift",
        repo: "re-cinq/lore",
      });

      const result = await runDetect({
        assemblyLineId,
        definitionName: "spec-drift",
        repo: "re-cinq/lore",
        dispatch: fakeDispatch(succeeded("unreached")).dispatch,
        assemblyLinesPort: assemblyLines,
        jobRunsPort: jobRuns,
        leaseBackend: backend,
      });

      expect(result.reason).toBe("lease_held");
      expect(jobRuns.rows[0]).toMatchObject({
        jobName: "spec_drift:re-cinq/lore",
        status: "completed",
        resultSummary: expect.stringContaining("lease held"),
      });
    });
  });
});
