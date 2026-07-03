// AssemblyLine StationBackend (ADR-031 D4, #688): the agent-cr execution path runs the assembly line
// assembly line Floor-side. launch() is fire-and-background — it kicks off runFloorAssemblyLineForTask
// (which walks the assembly line, dispatching a per-node Agent CR) and returns immediately, like
// the other async backends; the agent-watcher resolves completion (PR) from those Agents.

import type { LoreTaskSpec, StationBackend, StationLaunchResult } from "@re-cinq/lore-shared";
import { runFloorAssemblyLineForTask, type FloorAssemblyLineRuntime } from "./floor-assembly-line-run.js";

export class AssemblyLineStationBackend implements StationBackend {
  constructor(
    private readonly runtime: FloorAssemblyLineRuntime,
    private readonly run: typeof runFloorAssemblyLineForTask = runFloorAssemblyLineForTask,
  ) {}

  async launch(spec: LoreTaskSpec): Promise<StationLaunchResult> {
    void this.run(
      {
        taskId: spec.taskId,
        taskType: spec.taskType,
        description: spec.description,
        targetRepo: spec.targetRepo,
        branch: spec.branch,
      },
      this.runtime,
    ).catch((err) =>
      console.error(`[assembly-line-station] task ${spec.taskId} assembly line failed: ${(err as Error).message}`),
    );
    return { ref: spec.taskId, launched: true };
  }

  /** The assembly line walk runs in-process; the lease + per-node Agents are the real liveness
   *  signal. Conservative `true` so the reaper's age window governs, never killing a
   *  live walk on a transient probe. */
  async isActive(): Promise<boolean> {
    return true;
  }
}
