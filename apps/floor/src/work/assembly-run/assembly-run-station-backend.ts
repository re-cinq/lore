// AssemblyLine StationBackend (ADR-031 D4, #688): launch() is a pure producer — assemblyRuns.start() persists the run + event atomically, the Floor event loop walks it.

import type {
  LoreTaskSpec,
  StationBackend,
  StationLaunchResult,
} from "@re-cinq/lore-shared";
import type { AssemblyRunsPort } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  backlogSubject,
  featureSubject,
} from "@re-cinq/lore-shared/project/assembly-runs/subject-keys.js";

/** The subject a task's run works on, or undefined when it declares none — the shared builder keeps lore-api and the loop driver reading the same key (implementation-loop FR2). */
function subjectKeyFor(spec: LoreTaskSpec): string | undefined {
  if (spec.taskType === "implementation-loop") {
    return backlogSubject();
  }

  return spec.featureId ? featureSubject(spec.featureId) : undefined;
}

// Per-run values a definition can name with `continues.key: args.<name>`; the engine stays domain-free.
function launchArgsFor(spec: LoreTaskSpec): Record<string, unknown> {
  return {
    // Seeds FIRST — a context-bundle bag must never displace `description`, which fills {description} in every agent prompt.
    ...(spec.lineArgs ?? {}),
    description: spec.description,
    ...(spec.featureId ? { feature_id: spec.featureId } : {}),
    ...(spec.roundFeedback ? { round_feedback: spec.roundFeedback } : {}),
    ...(spec.resumeFromTask ? { resume_from_task: spec.resumeFromTask } : {}),
  };
}

export class AssemblyLineStationBackend implements StationBackend {
  constructor(private readonly assemblyRuns: AssemblyRunsPort) {}

  async launch(spec: LoreTaskSpec): Promise<StationLaunchResult> {
    const subjectKey = subjectKeyFor(spec);
    const assemblyLineId = await this.assemblyRuns.start({
      blueprintName: spec.taskType,
      repo: spec.targetRepo,
      branch: spec.branch,
      taskId: spec.taskId,
      // What this run WORKS ON: a feature's planning + finalize runs share a subject, so only one is open at a time.
      ...(subjectKey ? { subjectKey } : {}),
      args: launchArgsFor(spec),
    });

    // Only a subject-keyed start can have joined, so an unkeyed one asks nothing.
    if (!subjectKey) {
      return { ref: assemblyLineId, launched: true };
    }
    const run = await this.assemblyRuns.getById(assemblyLineId);

    enforceTrue(
      run !== null,
      Error,
      `assembly run ${assemblyLineId} is missing immediately after start`,
    );

    // start() is start-or-JOIN — a joined task owns no CR of its own and will never complete, so the caller must settle it.
    return run.taskId === spec.taskId
      ? { ref: assemblyLineId, launched: true }
      : { ref: assemblyLineId, launched: false, joinedRun: assemblyLineId };
  }

  /** Conservative `true` — the lease + per-node Agents are the real liveness signal; the reaper's age window governs, not a transient probe. */
  async isActive(): Promise<boolean> {
    return true;
  }
}
