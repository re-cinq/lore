import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { FileLeaseBackend } from "@re-cinq/lore-shared";
import { runSupervisor } from "./index.js";

/**
 * Chaos test for SC2 (pod-death survival, T028). Simulates a
 * supervisor pod that dies mid-flow without releasing its lease, then
 * verifies a fresh supervisor takes over after the lease expires —
 * without re-executing committed phases.
 *
 * The assembly line executor itself is the load-bearing piece for "no
 * re-execution"; that side is exercised by assembly-line-executor.test.ts's
 * resumeFromTrailers cases. This test focuses on the lease side: a
 * supervisor that finds the branch held by an expired pod must report
 * the takeover.
 */
describe("Pod-death takeover (T028)", () => {
  let tmpDir: string;
  let leasesDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "lore-poddeath-"));
    leasesDir = path.join(tmpDir, "leases");
    await fs.mkdir(leasesDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("a fresh supervisor exits cleanly when an existing lease is still valid", async () => {
    const backend = new FileLeaseBackend(leasesDir);
    // Pod A acquires and dies (lease still valid).
    await backend.acquire("lore/feature/x", "task-1", "pod-A", 600);

    // Pod B starts.
    const result = await runSupervisor({
      taskId: "task-1",
      branchName: "lore/feature/x",
      workflowName: "gap-fill",
      holder: "pod-B",
      leaseBackend: backend,
    });

    expect(result.ranWork).toBe(false);
    expect(result.reason).toBe("lease_held");
    expect(result.currentHolder).toBe("pod-A");
  });

  it("a fresh supervisor takes over an expired lease and runs (T027)", async () => {
    const backend = new FileLeaseBackend(leasesDir);
    // Pod A acquires and dies; lease was set with negative TTL so it's
    // already expired by the time pod B looks.
    await backend.acquire("lore/feature/x", "task-1", "pod-A", -1);

    // Pod B starts.
    const result = await runSupervisor({
      taskId: "task-1",
      branchName: "lore/feature/x",
      workflowName: "gap-fill",
      holder: "pod-B",
      leaseBackend: backend,
    });

    // Skeleton supervisor reports executor_pending (T014's body lands
    // before US1 ships, but the lease lifecycle works today).
    expect(result.ranWork).toBe(true);
    expect(result.reason).toBe("executor_pending");

    // Lease record should now be released by the supervisor's finally
    // block — file gone, ready for the next task.
    const files = await fs.readdir(leasesDir);
    expect(files).toHaveLength(0);
  });

  it("multiple successive supervisors take over after each prior one expires", async () => {
    const backend = new FileLeaseBackend(leasesDir);

    // Pod A's lease expires immediately, but the supervisor releases
    // on its own clean exit. Verify the transition chain works.
    for (const holder of ["pod-A", "pod-B", "pod-C"]) {
      const r = await runSupervisor({
        taskId: "task-1",
        branchName: "lore/feature/x",
        workflowName: "gap-fill",
        holder,
        leaseBackend: backend,
      });
      expect(r.ranWork).toBe(true);
    }

    // After all three: lease should be released cleanly.
    const files = await fs.readdir(leasesDir);
    expect(files).toHaveLength(0);
  });
});
