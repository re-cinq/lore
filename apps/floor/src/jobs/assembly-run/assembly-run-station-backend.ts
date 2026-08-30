// AssemblyLine StationBackend (ADR-031 D4, #688): the agent-cr execution path for task
// types that have an assembly line. launch() is a pure producer now — it calls
// project-level assemblyRuns.start(), which persists the pipeline.assembly_runs row
// and the assembly_line.start event atomically; the Floor event loop claims the event
// and walks the assembly line (dispatching a per-node Agent CR). The agent-watcher
// resolves task completion (PR) from those Agents, unchanged.

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

/** The subject a task's run works on, or undefined when it declares none.
 *
 *  The STRING comes from the shared builder, not from a template here: lore-api
 *  and the loop driver read runs by the same key, and two independent spellings
 *  would not fail to compile — they would just never match, which reads as
 *  "nothing in flight". A feature task works its feature; an implementation-loop
 *  task works the repo's backlog, which is what serialises the loop to one
 *  ticket per repo (implementation-loop FR2). */
function subjectKeyFor(spec: LoreTaskSpec): string | undefined {
  if (spec.taskType === "implementation-loop") {
    return backlogSubject();
  }

  return spec.featureId ? featureSubject(spec.featureId) : undefined;
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
      // What this run WORKS ON, which is not the same as which task asked for it:
      // a feature's planning run and its finalize run share a subject, so only one
      // can be open at a time and one query finds whichever it is.
      ...(subjectKey ? { subjectKey } : {}),
      // Per-run values a definition can name with `continues.key: args.<name>`.
      // The engine stays domain-free: it never learns what a feature is, it just
      // carries the value the consumer put here.
      args: {
        // Seeds FIRST: a context-bundle bag must never displace the keys below,
        // and `description` in particular is what fills {description} in every
        // agent prompt.
        ...(spec.lineArgs ?? {}),
        description: spec.description,
        ...(spec.featureId ? { feature_id: spec.featureId } : {}),
        ...(spec.roundFeedback ? { round_feedback: spec.roundFeedback } : {}),
        ...(spec.resumeFromTask
          ? { resume_from_task: spec.resumeFromTask }
          : {}),
      },
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

    // start() is start-or-JOIN: a subject already in flight yields ITS run, which
    // belongs to another task exactly when that happened. The difference matters —
    // a joined task owns no CR of its own and will never complete, so the caller
    // has to settle it rather than leave it running.
    return run.taskId === spec.taskId
      ? { ref: assemblyLineId, launched: true }
      : { ref: assemblyLineId, launched: false, joinedRun: assemblyLineId };
  }

  /** The assembly line walk runs in the event handler's background continuation; the
   *  lease + per-node Agents are the real liveness signal. Conservative `true` so the
   *  reaper's age window governs, never killing a live walk on a transient probe. */
  async isActive(): Promise<boolean> {
    return true;
  }
}
