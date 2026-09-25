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
import { roundHandoffOf } from "./round-handoff.js";
import { specPlanOf } from "./spec-plan-handoff.js";
import { specReviewFromArgs } from "@re-cinq/lore-shared/review/spec-review.js";
import { ciFeedbackOf } from "./ci-feedback.js";
import type { AdvanceDeps } from "./advance-deps.js";
import {
  collectPriorNodeFailures,
  loadWalkState,
  taskFromAssemblyRun,
  type WalkState,
} from "./walk-state.js";
import { launchNode, type NodeLaunch } from "./launch-node.js";
import { finishLine } from "./finish-line.js";
import { lineOutcomeFromVisits } from "./line-outcome.js";
import { PLANNING_AGENT_USER } from "../agent/planning-result.js";

export async function advanceLine(
  assemblyLineId: string,
  deps: AdvanceDeps,
): Promise<void> {
  const state = await loadWalkState(assemblyLineId, deps);

  if (!state) {
    return;
  }
  const transition = getNextTransition(state.runGraph, state.visits);

  // Nothing to launch: the walk is parked on a node still running, or it is over.
  if (transition.kind !== "launch") {
    await settleIfTerminal(transition, state.assemblyRun, state.visits, deps);

    return;
  }
  const node = launchableNode(state, transition.nodeId, deps);

  if (node) {
    await launchTransition(node, transition, state, deps);
  }
  // Also when the gate held the launch: the run is still in flight, and a required check must be there to block the merge.
  await deps.publishRunCheck?.(assemblyLineId);
}

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

/** The node to launch, or nothing when the gate is holding this run. An UNKNOWN node id throws (the definition and the persisted walk disagree, which no retry fixes); a blocked dispatch only parks, and is logged because this path returns void — the caller cannot otherwise tell "parked" from "advanced". */
function launchableNode(
  state: WalkState,
  nodeId: string,
  deps: AdvanceDeps,
): RunGraphNode | undefined {
  const { nodes, name } = state.runGraph;
  const node = nodes.find((n) => n.id === nodeId);

  enforceTrue(node, Error, `AssemblyLine ${name}: unknown node "${nodeId}"`);

  if (isAgentDispatchBlocked(node, deps)) {
    console.log(
      `[llm-dispatch-gate] parked ${state.assemblyRun.id} at node "${node.id}" — agent dispatch is blocked`,
    );

    return undefined;
  }

  return node;
}

/** Gated BEFORE the conversation lookup/row/CR: an agent node dispatched into a dry account would boot, install, call the API once, and die — only agent nodes are gated. */
function isAgentDispatchBlocked(
  node: RunGraphNode,
  deps: AdvanceDeps,
): boolean {
  return node.type === "agent" && (deps.llmGate?.isBlocked() ?? false);
}

/** The walk's launch, or a person's: a hand-run names who asked for it. */
export type Launch = Extract<Transition, { kind: "launch" }> & {
  requestedBy?: string;
};

/** Everything a launch reads apart from the dispatch it is about to resolve. */
type LaunchStep = Omit<NodeLaunch, "dispatch" | "deps">;

/** Launches the node the transition names. Split from the decision above so the walk reads as "what is next" then "run it" — the two failed for different reasons and were previously one function. A person running the station by hand names themself, which is what the replay restarts at. */
export async function launchTransition(
  node: RunGraphNode,
  transition: Launch,
  state: WalkState,
  deps: AdvanceDeps,
): Promise<void> {
  await launchResolved(
    await resolveLaunch(node, transition, state, deps),
    deps,
  );
}

/** Everything a launch needs, resolved and nothing written yet: a throw here (an unknown recipe, say) leaves the run exactly as it was, which is why a hand-run resolves BEFORE it cancels the wait it moves past. */
export type ResolvedLaunch = Omit<NodeLaunch, "deps">;

export async function resolveLaunch(
  node: RunGraphNode,
  transition: Launch,
  state: WalkState,
  deps: AdvanceDeps,
): Promise<ResolvedLaunch> {
  const { iteration, requestedBy } = transition;
  const step: LaunchStep = {
    node,
    task: taskFromAssemblyRun(state.assemblyRun),
    assemblyRun: state.assemblyRun,
    visits: state.visits,
    iteration,
    ...(requestedBy ? { requestedBy } : {}),
  };

  return { ...step, dispatch: await dispatchForNode(step, node.id, deps) };
}

/** Writes the row and hands the node to its runner. */
export async function launchResolved(
  launch: ResolvedLaunch,
  deps: AdvanceDeps,
): Promise<void> {
  await openPlanPresence(launch, deps);
  await launchNode({ ...launch, deps });
}

/** Tells the plan's people the planning agent is about to write, before the analyze pod launches. */
async function openPlanPresence(
  launch: ResolvedLaunch,
  deps: AdvanceDeps,
): Promise<void> {
  const planId = launch.assemblyRun.args?.plan_id;

  if (launch.node.id !== "analyze" || typeof planId !== "string") {
    return;
  }
  await deps.plans?.openPresence(planId, PLANNING_AGENT_USER);
}

/** Resolved BEFORE the station_runs row is written, because the row RECORDS the dispatch — otherwise the prompt and round content exist only on an Agent CR that gets pruned. The failure, CI and hand-off reads are how a retry learns why it runs again, what the build said about the last push, and what the previous round left for next. */
async function dispatchForNode(
  step: LaunchStep,
  nodeId: string,
  deps: AdvanceDeps,
): ReturnType<typeof resolveNodeDispatch> {
  const priorFailures = await priorFailuresIfAgent(step, nodeId, deps);

  return await resolveNodeDispatch(
    dispatchInput(step, nodeId, priorFailures),
    deps,
  );
}

/** Everything a dispatch is resolved from: the visit trail read four ways (retry cause, this node's own failures, the build's verdict, the previous round's hand-off), plus the spec analysis the args carry for a recipe that asks for it and the spec review a rework answers. */
function dispatchInput(
  step: LaunchStep,
  nodeId: string,
  priorFailures: PriorFailure[] | undefined,
): Parameters<typeof resolveNodeDispatch>[0] {
  const { node, visits, task } = step;
  const args = task.args ?? {};

  return {
    node,
    task,
    iteration: step.iteration,
    priorOutcome: priorOutcomeOf(visits, nodeId),
    incomingFailure: incomingFailureOf(visits),
    ciFeedback: ciFeedbackOf(visits, args),
    roundHandoff: roundHandoffOf(args),
    specPlan: specPlanOf(args),
    specReview: specReviewFromArgs(args),
    priorFailures,
  };
}

/** Fork chain included; only an agent's prompt reads it, only a fork pays the source-run reads. */
async function priorFailuresIfAgent(
  step: LaunchStep,
  nodeId: string,
  deps: AdvanceDeps,
): Promise<PriorFailure[] | undefined> {
  return step.node.type === "agent"
    ? collectPriorNodeFailures(step.assemblyRun, nodeId, step.visits, deps)
    : undefined;
}
