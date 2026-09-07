/** Recording one node's terminal outcome and its side-effects: the node-finished reaction, the PR stamp, and taking the PR out of draft. */

import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import {
  resolveRunGraph,
  selectEdge,
  type NodeResult,
} from "@re-cinq/lore-assembly-lines";
import type { RunGraphNode } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import {
  decideMarkReady,
  decidePrStamp,
  decideStampFailure,
  emptyBranchReason,
} from "./spec-pr.js";
import type { AdvanceDeps } from "./advance-deps.js";
import { advanceLine } from "./advance-line.js";
import { finishLine } from "./finish-line.js";

/** The node matching `nodeId` in the run's current graph, or undefined when the run has no graph or the graph does not carry that id. */
async function findRunNode(
  row: AssemblyRunRecord,
  nodeId: string,
  deps: Pick<AdvanceDeps, "definitions">,
): Promise<RunGraphNode | undefined> {
  const graph = await resolveRunGraph(row, deps.definitions);

  return graph?.nodes.find((candidate) => candidate.id === nodeId);
}

/** Runs the node-finished reaction and never lets it stop the walk — same bias as `maybeStampPr`: a failed follow-up is a log line, not a permanently parked run. */
async function reactToNodeFinished(
  assemblyLineId: string,
  nodeId: string,
  result: NodeResult,
  deps: AdvanceDeps,
): Promise<void> {
  if (!deps.onNodeFinished) {
    return;
  }

  try {
    const row = await deps.assemblyRuns.getById(assemblyLineId);

    if (!row) {
      return;
    }
    const node = await findRunNode(row, nodeId, deps);

    if (!node) {
      // A node the graph does not know is a wiring bug (snapshot graph disagrees with the finished id) — logged rather than silently dropped, since silence is the exact failure this hook was re-keyed to prevent.
      console.warn(
        `[assembly-run] ${assemblyLineId}: node ${nodeId} is not in the run's graph — node-finished reaction skipped`,
      );

      return;
    }
    await deps.onNodeFinished(row, node, result);
  } catch (err) {
    console.warn(
      `[assembly-run] node-finished reaction failed for ${nodeId}:`,
      (err as Error).message,
    );
  }
}

/** The type of the node the walk lands on next from `fromNodeId`, following this outcome's edge; undefined without a graph or a matching edge. */
function nextNodeTypeAfter(
  graph: Awaited<ReturnType<typeof resolveRunGraph>>,
  fromNodeId: string,
  outcome: NodeResult["outcome"],
): string | undefined {
  if (!graph) {
    return undefined;
  }
  const toId = selectEdge(graph, fromNodeId, outcome)?.to;

  return graph.nodes.find((n) => n.id === toId)?.type;
}

/** Flips the PR out of draft when the finished step hands off to the human wait; never fails the run — a draft PR is recoverable, discarding finished work is not. */
/** Whether this node finishing leaves the PR ready for a human. The NEXT node's type is what decides it: a run heading into another agent pass is not done, however well this node went. */
async function shouldMarkReady(
  assemblyRun: AssemblyRunRecord,
  nodeId: string,
  result: NodeResult,
  deps: AdvanceDeps,
): Promise<boolean> {
  const graph = await resolveRunGraph(assemblyRun, deps.definitions);

  return decideMarkReady({
    outcome: result.outcome,
    nextNodeType: nextNodeTypeAfter(graph, nodeId, result.outcome),
    args: assemblyRun.args,
  });
}

async function maybeMarkPrReady(
  assemblyLineId: string,
  nodeId: string,
  result: NodeResult,
  deps: AdvanceDeps,
): Promise<void> {
  if (!deps.markPrReady) {
    return;
  }
  const assemblyRun = await deps.assemblyRuns.getById(assemblyLineId);

  if (!assemblyRun) {
    return;
  }

  try {
    if (!(await shouldMarkReady(assemblyRun, nodeId, result, deps))) {
      return;
    }

    await deps.markPrReady(assemblyRun, result);
    // Written AFTER the flip so a fix-ci round-trip doesn't rewrite the PR body twice; a crash between the two costs one redundant idempotent flip.
    await deps.assemblyRuns.mergeArgs(assemblyLineId, {
      pr_ready_flipped: true,
    });
  } catch (err) {
    console.error("[spec-pr] mark-ready failed:", (err as Error).message);
  }
}

/** An empty-branch stamp failure (#1330) fails the line outright — otherwise the wait node downstream parks forever on a PR that cannot exist. Any other failure is transient and left for the reaper to re-drive. */
async function handleStampFailure(
  err: unknown,
  assemblyRun: AssemblyRunRecord,
  deps: AdvanceDeps,
): Promise<void> {
  const message = (err as Error).message;

  console.error("[spec-pr] stamp failed:", message);

  if (decideStampFailure(message) !== "empty-branch") {
    return;
  }
  await finishLine(
    assemblyRun,
    "error",
    emptyBranchReason(assemblyRun.branch),
    deps,
  );
}

/** Stamps the PR from the `push` node's result; never throws for a transient failure (the reaper re-drives), but an EMPTY branch (#1330) fails the line instead — otherwise the wait node downstream parks forever on a PR that cannot exist. */
async function maybeStampPr(
  assemblyLineId: string,
  nodeId: string,
  result: NodeResult,
  deps: AdvanceDeps,
): Promise<void> {
  if (!deps.stampPr) {
    return;
  }
  const assemblyRun = await deps.assemblyRuns.getById(assemblyLineId);

  if (!assemblyRun) {
    return;
  }

  try {
    const node = await findRunNode(assemblyRun, nodeId, deps);

    if (
      !decidePrStamp({
        promptRef: node?.prompt_ref,
        outcome: result.outcome,
        args: assemblyRun.args,
      })
    ) {
      return;
    }

    await deps.stampPr(assemblyRun);
  } catch (err) {
    await handleStampFailure(err, assemblyRun, deps);
  }
}

/** Record one node's terminal outcome (CAS — first writer decides) and advance the line; `iteration` targets the exact revisit whose CR fired so a late duplicate event can't overwrite the current one. */
/** Closes exactly one open row for this node, and says whether THIS delivery is the one that closed it. A missing target or a lost CAS both mean another delivery got there first — its follow-up has already fired, and firing again would re-route a result that was just routed. */
async function closeNodeRow(
  input: {
    assemblyLineId: string;
    nodeId: string;
    iteration?: number;
    result: NodeResult;
  },
  deps: AdvanceDeps,
): Promise<boolean> {
  const nodes = await deps.assemblyRuns.listStationRuns(input.assemblyLineId);
  const forNode = nodes.filter((n) => n.nodeId === input.nodeId);
  const target =
    input.iteration !== undefined
      ? forNode.find(
          (n) => n.iteration === input.iteration && n.outcome === null,
        )
      : forNode.filter((n) => n.outcome === null).at(-1);

  return (
    target !== undefined &&
    (await deps.assemblyRuns.finishStationRunOnce(
      target.id,
      input.result.outcome,
      undefined,
      {
        failureClass: input.result.failureClass,
        failureDetail: input.result.failureDetail,
      },
    ))
  );
}

export async function finishNodeAndAdvance(
  input: {
    assemblyLineId: string;
    nodeId: string;
    iteration?: number;
    result: NodeResult;
  },
  deps: AdvanceDeps,
): Promise<void> {
  const { assemblyLineId, nodeId, result } = input;

  // Once-only effects are CAS-gated; the walk is NOT — advanceLine re-derives its step from the node rows, so re-running it recovers a delivery that closed the node then died before advancing.
  if (await closeNodeRow(input, deps)) {
    await maybeStampPr(assemblyLineId, nodeId, result, deps);
    await maybeMarkPrReady(assemblyLineId, nodeId, result, deps);
    await reactToNodeFinished(assemblyLineId, nodeId, result, deps);
  }

  await advanceLine(assemblyLineId, deps);
}
