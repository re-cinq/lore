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

    await deps.assemblyLines.finish(assemblyLineId, outcome, reason);
    await deps.cleanupToken(row.taskId ?? row.id);

    return;
  }

  const node = definition.nodes.find((n) => n.id === transition.nodeId);

  enforceTrue(
    node,
    Error,
    `AssemblyLine ${definition.name}: unknown node "${transition.nodeId}"`,
  );
  const task = taskFromRow(row);
  const spec =
    node.type === "agent"
      ? nodeAgentSpec(
          node,
          task,
          deps.resolvePrompt(node.prompt_ref ?? node.type, task.description),
        )
      : nodeStationSpec(node, task);

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

/** Record one node's terminal outcome (CAS — the first writer decides; a losing
 *  duplicate advances with the stored outcome) and advance the line. */
export async function finishNodeAndAdvance(
  input: { assemblyLineId: string; nodeId: string; result: NodeResult },
  deps: AdvanceDeps,
): Promise<void> {
  const nodes = await deps.assemblyLines.listNodes(input.assemblyLineId);
  const open = nodes
    .filter((n) => n.nodeId === input.nodeId && n.outcome === null)
    .at(-1);

  if (open) {
    await deps.assemblyLines.finishNodeOnce(open.id, input.result.outcome);
  }

  await advanceLine(input.assemblyLineId, deps);
}
