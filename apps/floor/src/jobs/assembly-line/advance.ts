// The event-driven walk's shared IO orchestration (spec 6-dark-factory FR6): every
// node-terminal event (or reaper-synthesized timeout) records the node's outcome and
// re-derives "what happens next" purely from the persisted node rows (nextTransition).
// There is no walker process — a Floor restart loses nothing; duplicate/concurrent
// advancers converge on the UNIQUE (line, node, iteration) row and the 409-idempotent
// CR create.

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { LoreTaskSpec } from "@re-cinq/lore-shared";
import type {
  AssemblyLinesPort,
  AssemblyLineRecord,
} from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-port.js";
import {
  nextTransition,
  type AssemblyLine,
  type NodeVisit,
  type NodeResult,
  type StageOutcome,
} from "@re-cinq/lore-assembly-lines";
import {
  nodeAgentSpec,
  nodeStationSpec,
  type FloorAssemblyLineTask,
} from "./floor-assembly-line.js";

export interface AdvanceDeps {
  assemblyLines: AssemblyLinesPort;
  /** The loaded builtin assembly line YAMLs — the walk's transition table. */
  definitions: () => Promise<ReadonlyMap<string, AssemblyLine>>;
  /** Dispatch one node's Agent CR (agentCrBackend().launch — 409 is a no-op). */
  launch: (spec: LoreTaskSpec) => Promise<void>;
  resolvePrompt: (promptRef: string, description: string) => string;
  /** Reclaim the run's per-task token once the line is terminal. */
  cleanupToken: (runTaskId: string) => Promise<void>;
  /** Detection-line bookkeeping: close the `args.job_run_id` pipeline.job_runs row
   *  with the line's terminal state (the fan-out pre-created it). */
  jobRuns: {
    complete(runId: string, resultSummary: string): Promise<unknown>;
    fail(runId: string, reason: string): Promise<unknown>;
  };
}

/** The walk task shape, derived from the persisted row instead of an in-memory task. */
export function taskFromRow(row: AssemblyLineRecord): FloorAssemblyLineTask {
  return {
    taskId: row.taskId ?? row.id,
    pipelineTaskId: row.taskId,
    assemblyLineId: row.id,
    taskType: row.definitionName,
    description: String(row.args.description ?? ""),
    targetRepo: row.repo,
    branch: row.branch ?? "",
  };
}

/** Re-derive the line's next step from its node rows and perform it: launch the next
 *  node CR, finish the row, or fail it. Safe to call redundantly — no-ops unless the
 *  replay says there is something to do. */
export async function advanceLine(
  assemblyLineId: string,
  deps: AdvanceDeps,
): Promise<void> {
  const row = await deps.assemblyLines.getById(assemblyLineId);

  if (!row || row.status !== "running") {
    return;
  }

  const definition = (await deps.definitions()).get(row.definitionName);

  if (!definition) {
    // A single-CR run record (FR6.8) — the agent-watcher owns its lifecycle.
    return;
  }

  const nodes = await deps.assemblyLines.listNodes(assemblyLineId);

  // Overlap guard (branch-lease parity): a second not-yet-started run on the same
  // repo+branch defers to the one already in flight — the detect fan-out relies on
  // this to suppress duplicate per-repo runs, exactly as the old lease did.
  if (nodes.length === 0 && row.branch) {
    const overlapping = (await deps.assemblyLines.listOpen()).some(
      (other) =>
        other.id !== row.id &&
        other.status === "running" &&
        other.repo === row.repo &&
        other.branch === row.branch,
    );

    if (overlapping) {
      await finishLine(
        row,
        "lease_held",
        "another run holds this branch",
        deps,
      );

      return;
    }
  }

  const visits: NodeVisit[] = nodes.map((n) => ({
    nodeId: n.nodeId,
    iteration: n.iteration,
    outcome: n.outcome as StageOutcome | null,
  }));
  const transition = nextTransition(definition, visits);

  if (transition.kind === "await") {
    return;
  }

  if (transition.kind === "finish" || transition.kind === "fail") {
    const outcome =
      transition.kind === "finish" ? "completed" : transition.outcome;
    const reason = transition.kind === "fail" ? transition.reason : undefined;

    await finishLine(row, outcome, reason, deps);

    return;
  }

  const node = definition.nodes.find((n) => n.id === transition.nodeId);

  enforceTrue(
    node,
    Error,
    `AssemblyLine ${definition.name}: unknown node "${transition.nodeId}"`,
  );
  const task = taskFromRow(row);
  // Iteration rides into the CR name + labels so a revisited node runs a fresh pod.
  const spec =
    node.type === "agent"
      ? nodeAgentSpec(
          node,
          task,
          deps.resolvePrompt(node.prompt_ref ?? node.type, task.description),
          transition.iteration,
        )
      : nodeStationSpec(node, task, transition.iteration);

  // Row before CR: a crash in between leaves an open row the reaper resolves by
  // reading the (deterministically named) CR; a rowless CR would be invisible.
  await deps.assemblyLines.ensureNodeStart({
    assemblyLineId,
    nodeId: node.id,
    iteration: transition.iteration,
    agentCrName: spec.name,
  });
  await deps.launch(spec);
}

/** Close the row, reclaim the token, and settle the detect fan-out's job_run. */
async function finishLine(
  row: AssemblyLineRecord,
  outcome: string,
  reason: string | undefined,
  deps: AdvanceDeps,
): Promise<void> {
  await deps.assemblyLines.finish(row.id, outcome, reason);
  await deps.cleanupToken(row.taskId ?? row.id);

  const jobRunId = row.args.job_run_id;

  if (typeof jobRunId !== "string" || jobRunId.length === 0) {
    return;
  }

  if (outcome === "error" || outcome === "iteration_max") {
    await deps.jobRuns.fail(jobRunId, reason ?? outcome);
  } else if (outcome === "lease_held") {
    await deps.jobRuns.complete(jobRunId, `skipped: ${reason}`);
  } else {
    await deps.jobRuns.complete(
      jobRunId,
      `station run: ${row.definitionName}:${row.repo} ${outcome}`,
    );
  }
}

/** Record one node's terminal outcome (CAS — the first writer decides; a losing
 *  duplicate advances with the stored outcome) and advance the line. `iteration`
 *  (from the CR's label) targets the exact revisit whose CR fired, so a late
 *  duplicate event for a prior iteration can't overwrite the current one. */
export async function finishNodeAndAdvance(
  input: {
    assemblyLineId: string;
    nodeId: string;
    iteration?: number;
    result: NodeResult;
  },
  deps: AdvanceDeps,
): Promise<void> {
  const nodes = await deps.assemblyLines.listNodes(input.assemblyLineId);
  const forNode = nodes.filter((n) => n.nodeId === input.nodeId);
  const target =
    input.iteration !== undefined
      ? forNode.find(
          (n) => n.iteration === input.iteration && n.outcome === null,
        )
      : forNode.filter((n) => n.outcome === null).at(-1);

  if (target) {
    await deps.assemblyLines.finishNodeOnce(target.id, input.result.outcome);
  }

  await advanceLine(input.assemblyLineId, deps);
}
