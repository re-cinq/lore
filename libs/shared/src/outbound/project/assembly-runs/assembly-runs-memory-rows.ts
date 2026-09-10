// The row builders of InMemoryAssemblyRuns: what a fork inherits from its source, and what a freshly queued run starts as. Pure, so the double's rows stay one declaration rather than defaults scattered through the store.

import type {
  AssemblyRunRecord,
  AssemblyRunStartInput,
} from "./assembly-runs-port.js";
import { forkSubjectKey } from "./resume.js";

/** Fork inherits branch/taskId/subject (+args unless overridden) from source — the subject rides along because a fork re-runs the same work and must hold its source's guard. */
export function inheritFromSource(
  input: AssemblyRunStartInput,
  source: AssemblyRunRecord | null,
): AssemblyRunStartInput {
  if (!source) {
    return input;
  }

  return {
    ...input,
    branch: source.branch ?? undefined,
    taskId: source.taskId ?? undefined,
    subjectKey: forkSubjectKey(input, source) ?? undefined,
    args: input.args ?? source.args,
  };
}

/** Extracted from newRow so its many `??` defaults don't inflate that function's complexity. */
export function resumeRefs(input: AssemblyRunStartInput): {
  resumedFromRunId: string | null;
  resumedFromNodeId: string | null;
} {
  return {
    resumedFromRunId: input.resumeFrom?.lineId ?? null,
    resumedFromNodeId: input.resumeFrom?.nodeId ?? null,
  };
}

/** The lifecycle columns of a freshly queued run — nothing has happened to it yet, so every outcome-shaped column is still empty. */
export function newRunLifecycle(now: Date) {
  return {
    graph: null,
    status: "queued" as const,
    outcome: null,
    reason: null,
    blueprintHash: null,
    inheritedNodeCount: 0,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
  };
}
