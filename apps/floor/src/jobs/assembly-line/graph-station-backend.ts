// Graph StationBackend (ADR-031 D4, #688): the agent-cr execution path runs the workflow
// graph Floor-side. launch() is fire-and-background — it kicks off runFloorGraphForTask
// (which walks the graph, dispatching a per-node Agent CR) and returns immediately, like
// the other async backends; the agent-watcher resolves completion (PR) from those Agents.

import type { LoreTaskSpec, StationBackend, StationLaunchResult } from "@re-cinq/lore-shared";
import { runFloorGraphForTask, type FloorGraphRuntime } from "./floor-graph-run.js";

export class GraphStationBackend implements StationBackend {
  constructor(
    private readonly runtime: FloorGraphRuntime,
    private readonly run: typeof runFloorGraphForTask = runFloorGraphForTask,
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
      console.error(`[graph-station] task ${spec.taskId} graph failed: ${(err as Error).message}`),
    );
    return { ref: spec.taskId, launched: true };
  }

  /** The graph walk runs in-process; the lease + per-node Agents are the real liveness
   *  signal. Conservative `true` so the reaper's age window governs, never killing a
   *  live walk on a transient probe. */
  async isActive(): Promise<boolean> {
    return true;
  }
}
