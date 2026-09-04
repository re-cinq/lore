/** What the walk replays from: the current run row, its graph, and the visits recorded so far. */

import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { NodeVisit, StageOutcome } from "@re-cinq/lore-assembly-lines";
import { resolveRunGraph } from "@re-cinq/lore-assembly-lines";
import type { RunGraph } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import type { FloorAssemblyRunTask } from "./floor-assembly-run.js";
import { priorFailuresOf, type PriorFailure } from "./launch-spec.js";
import type { AdvanceDeps } from "./advance-deps.js";

/** The walk task shape, derived from the persisted row instead of an in-memory task. */
export function taskFromAssemblyRun(
  assemblyRun: AssemblyRunRecord,
): FloorAssemblyRunTask {
  return {
    taskId: assemblyRun.taskId ?? assemblyRun.id,
    pipelineTaskId: assemblyRun.taskId,
    assemblyLineId: assemblyRun.id,
    taskType: assemblyRun.blueprintName,
    description: String(assemblyRun.args.description ?? ""),
    targetRepo: assemblyRun.repo,
    branch: assemblyRun.branch ?? "",
    args: assemblyRun.args,
  };
}

/** Cap on fork-chain depth read for prior-failure context — a run forked many times over carries diminishing history at growing read cost. */
const MAX_FORK_HOPS = 5;

/** The launched node's earlier failed attempts, oldest first: the fork chain's (a fork nulls `failure_detail` on its copied prefix rows, so each attempt's failure lives only on its source run), then this run's. */
export async function collectPriorNodeFailures(
  assemblyRun: AssemblyRunRecord,
  nodeId: string,
  visits: ReadonlyArray<{
    nodeId: string;
    iteration: number;
    outcome: string | null;
    failureDetail?: string | null;
  }>,
  deps: Pick<AdvanceDeps, "assemblyRuns">,
): Promise<PriorFailure[]> {
  const chain: PriorFailure[] = [];
  let sourceId = assemblyRun.resumedFromRunId;

  for (let hop = 0; sourceId !== null && hop < MAX_FORK_HOPS; hop++) {
    const sourceRun = await deps.assemblyRuns.getById(sourceId);

    if (!sourceRun) {
      break;
    }
    const sourceRows = await deps.assemblyRuns.listStationRuns(sourceId);

    chain.unshift(...priorFailuresOf(sourceRows, nodeId));
    sourceId = sourceRun.resumedFromRunId;
  }

  return [...chain, ...priorFailuresOf(visits, nodeId)];
}

/** What the walk replays from: the open run, the graph it walks, and the visits recorded so far. Null when there is nothing to walk — the run is gone or finished, or it is a single-CR record (FR6.8) whose lifecycle the agent-watcher owns. */
export async function loadWalkState(
  assemblyLineId: string,
  deps: AdvanceDeps,
): Promise<{
  assemblyRun: AssemblyRunRecord;
  runGraph: RunGraph;
  visits: NodeVisit[];
} | null> {
  const assemblyRun = await deps.assemblyRuns.getById(assemblyLineId);

  if (!assemblyRun || assemblyRun.status !== "running") {
    return null;
  }
  const runGraph = await resolveRunGraph(assemblyRun, deps.definitions);

  if (!runGraph) {
    return null;
  }
  const nodes = await deps.assemblyRuns.listStationRuns(assemblyLineId);

  return {
    assemblyRun,
    runGraph,
    // Read off the rows so the replay survives a Floor restart mid-line.
    visits: nodes.map((n) => ({
      nodeId: n.nodeId,
      iteration: n.iteration,
      outcome: n.outcome as StageOutcome | null,
      failureClass: n.failureClass,
      failureDetail: n.failureDetail,
    })),
  };
}
