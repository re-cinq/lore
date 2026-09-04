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
  const node = runGraph.nodes.find((n) => n.id === transition.nodeId);

  enforceTrue(
    node,
    Error,
    `AssemblyLine ${runGraph.name}: unknown node "${transition.nodeId}"`,
  );

  if (isAgentDispatchBlocked(node, deps)) {
    // Logged because parking is otherwise INVISIBLE: this returns void, so the caller cannot distinguish "parked" from "advanced".
    console.log(
      `[llm-dispatch-gate] parked ${assemblyRun.id} at node "${node.id}" — agent dispatch is blocked`,
    );

    return;
  }
  const task = taskFromAssemblyRun(assemblyRun);
  // Resolved BEFORE the row, because the row RECORDS it — otherwise the prompt/round content only exists on a pruned Agent CR.
  const dispatch = await resolveNodeDispatch(
    {
      node,
      task,
      iteration: transition.iteration,
      priorOutcome: priorOutcomeOf(visits, transition.nodeId),
      // How a retried node learns why it is running again instead of repeating itself.
      incomingFailure: incomingFailureOf(visits),
      priorFailures: await priorFailuresIfAgent(
        { node, assemblyRun, nodeId: transition.nodeId, visits },
        deps,
      ),
    },
    deps,
  );

  await launchNode({
    node,
    task,
    dispatch,
    visits,
    assemblyRun,
    iteration: transition.iteration,
    deps,
  });
}
