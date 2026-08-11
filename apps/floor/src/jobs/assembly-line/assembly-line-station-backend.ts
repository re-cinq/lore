// AssemblyLine StationBackend (ADR-031 D4, #688): the agent-cr execution path for task
// types that have an assembly line. launch() is a pure producer now — it calls
// project-level assemblyLines.start(), which persists the pipeline.assembly_lines row
// and the assembly_line.start event atomically; the Floor event loop claims the event
// and walks the assembly line (dispatching a per-node Agent CR). The agent-watcher
// resolves task completion (PR) from those Agents, unchanged.

import type {
  LoreTaskSpec,
  StationBackend,
  StationLaunchResult,
} from "@re-cinq/lore-shared";
import type { AssemblyLinesPort } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-port.js";

export class AssemblyLineStationBackend implements StationBackend {
  constructor(private readonly assemblyLines: AssemblyLinesPort) {}

  async launch(spec: LoreTaskSpec): Promise<StationLaunchResult> {
    const assemblyLineId = await this.assemblyLines.start({
      definitionName: spec.taskType,
      repo: spec.targetRepo,
      branch: spec.branch,
      taskId: spec.taskId,
      // Per-run values a definition can name with `continues.key: args.<name>`.
      // The engine stays domain-free: it never learns what a feature is, it just
      // carries the value the consumer put here.
      args: {
        description: spec.description,
        ...(spec.featureId ? { feature_id: spec.featureId } : {}),
        ...(spec.roundFeedback ? { round_feedback: spec.roundFeedback } : {}),
      },
    });

    return { ref: assemblyLineId, launched: true };
  }

  /** The assembly line walk runs in the event handler's background continuation; the
   *  lease + per-node Agents are the real liveness signal. Conservative `true` so the
   *  reaper's age window governs, never killing a live walk on a transient probe. */
  async isActive(): Promise<boolean> {
    return true;
  }
}
