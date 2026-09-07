/** Re-derives the line's next step from its node rows and performs it (launch/finish/fail); safe to call redundantly. */

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { AssemblyRunRecord } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import {
  getNextTransition,
  type NodeVisit,
} from "@re-cinq/lore-assembly-lines";
import { type Transition } from "@re-cinq/lore-assembly-lines";
import type { RunGraphNode } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import {
  incomingFailureOf,
  priorOutcomeOf,
  resolveNodeDispatch,
  type PriorFailure,
} from "./launch-spec.js";
import type { AdvanceDeps } from "./advance-deps.js";
import {
  collectPriorNodeFailures,
  loadWalkState,
  taskFromAssemblyRun,
} from "./walk-state.js";
import { launchNode } from "./launch-node.js";
import { finishLine } from "./finish-line.js";
import { lineOutcomeFromVisits } from "./line-outcome.js";

/** Close the run when the walk is over. `await` means a node is still running, so nothing settles. A `finish` reads its outcome back off the visits, because a line whose last node succeeded can still have failed earlier. */
async function settleIfTerminal(
  transition: Exclude<Transition, { kind: "launch" }>,
  assemblyRun: AssemblyRunRecord,
  visits: NodeVisit[],
  deps: AdvanceDeps,
): Promise<void> {
  if (transition.kind === "await") {
    return;
  }
  const { outcome, reason } =
    transition.kind === "finish"
      ? lineOutcomeFromVisits(visits)
      : { outcome: transition.outcome, reason: transition.reason };

  await finishLine(assemblyRun, outcome, reason, deps);
}

/** Gated BEFORE the conversation lookup/row/CR: an agent node dispatched into a dry account would boot, install, call the API once, and die — only agent nodes are gated. */
function isAgentDispatchBlocked(
  node: RunGraphNode,
  deps: AdvanceDeps,
): boolean {
  return node.type === "agent" && (deps.llmGate?.isBlocked() ?? false);
}

interface PriorFailuresLookup {
  node: RunGraphNode;
  assemblyRun: AssemblyRunRecord;
  nodeId: string;
  visits: NodeVisit[];
}

/** Fork chain included; only an agent's prompt reads it, only a fork pays the source-run reads. */
async function priorFailuresIfAgent(
  { node, assemblyRun, nodeId, visits }: PriorFailuresLookup,
  deps: AdvanceDeps,
): Promise<PriorFailure[] | undefined> {
  return node.type === "agent"
    ? collectPriorNodeFailures(assemblyRun, nodeId, visits, deps)
    : undefined;
}

/** Resolved BEFORE the station_runs row is written, because the row RECORDS the dispatch — otherwise the prompt and round content exist only on an Agent CR that gets pruned. */
async function dispatchForNode(
  ctx: {
    node: RunGraphNode;
    task: ReturnType<typeof taskFromAssemblyRun>;
    assemblyRun: AssemblyRunRecord;
    nodeId: string;
    iteration: number;
    visits: NodeVisit[];
  },
  deps: AdvanceDeps,
): ReturnType<typeof resolveNodeDispatch> {
  const { node, task, assemblyRun, nodeId, iteration, visits } = ctx;

  return await resolveNodeDispatch(
    {
      node,
      task,
      iteration,
      priorOutcome: priorOutcomeOf(visits, nodeId),
      // How a retried node learns why it is running again instead of repeating itself.
      incomingFailure: incomingFailureOf(visits),
      priorFailures: await priorFailuresIfAgent(
        { node, assemblyRun, nodeId, visits },
        deps,
      ),
    },
    deps,
  );
}

/** The node to launch, or nothing when the gate is holding this run. An UNKNOWN node id throws (the definition and the persisted walk disagree, which no retry fixes); a blocked dispatch only parks, and is logged because this path returns void — the caller cannot otherwise tell "parked" from "advanced". */
function launchableNode(
  runGraph: { name: string; nodes: RunGraphNode[] },
  nodeId: string,
  assemblyRun: AssemblyRunRecord,
  deps: AdvanceDeps,
): RunGraphNode | undefined {
  const node = runGraph.nodes.find((n) => n.id === nodeId);

  enforceTrue(
    node,
    Error,
    `AssemblyLine ${runGraph.name}: unknown node "${nodeId}"`,
  );

  if (isAgentDispatchBlocked(node, deps)) {
    console.log(
      `[llm-dispatch-gate] parked ${assemblyRun.id} at node "${node.id}" — agent dispatch is blocked`,
    );

    return undefined;
  }

  return node;
}

/** Launches the node the transition names. Split from the decision above so the walk reads as "what is next" then "run it" — the two failed for different reasons and were previously one function. */
async function launchTransition(
  step: {
    node: RunGraphNode;
    assemblyRun: AssemblyRunRecord;
    visits: NodeVisit[];
    iteration: number;
    nodeId: string;
  },
  deps: AdvanceDeps,
): Promise<void> {
  const { node, assemblyRun, visits, iteration, nodeId } = step;
  const task = taskFromAssemblyRun(assemblyRun);
  const dispatch = await dispatchForNode(
    { node, task, assemblyRun, nodeId, iteration, visits },
    deps,
  );

  await launchNode({
    node,
    task,
    dispatch,
    visits,
    assemblyRun,
    iteration,
    deps,
  });
}

export async function advanceLine(
  assemblyLineId: string,
  deps: AdvanceDeps,
): Promise<void> {
  const state = await loadWalkState(assemblyLineId, deps);

  if (!state) {
    return;
  }
  const { assemblyRun, runGraph, visits } = state;
  const transition = getNextTransition(runGraph, visits);

  // Nothing to launch: the walk is parked on a node still running, or it is over.
  if (transition.kind !== "launch") {
    await settleIfTerminal(transition, assemblyRun, visits, deps);

    return;
  }
  const node = launchableNode(runGraph, transition.nodeId, assemblyRun, deps);

  if (!node) {
    return;
  }

  await launchTransition(
    {
      node,
      assemblyRun,
      visits,
      iteration: transition.iteration,
      nodeId: transition.nodeId,
    },
    deps,
  );
}
