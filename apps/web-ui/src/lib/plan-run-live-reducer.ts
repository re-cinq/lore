// The plan page's live fold of what node_status/run_status frames carry directly; mirrors run-live-reducer.ts.

import type { AssemblyRunNode } from "./assembly-run-rows";
import { ifFrame, nodeStatusBranch, runStatusFacts } from "./run-stream-fold";
import type { RunStreamFrame } from "./run-stream-types";

export interface PlanRunLiveFacts {
  status: string;
  outcome: string | null;
  reason: string | null;
}

export interface PlanRunLiveState {
  run: PlanRunLiveFacts;
  /** Visit rows in visit order; a re-sent row replaces its `(nodeId, iteration)` predecessor in place. */
  nodes: AssemblyRunNode[];
}

export function initialPlanRunLive(
  run: PlanRunLiveFacts,
  nodes: readonly AssemblyRunNode[],
): PlanRunLiveState {
  return {
    run: { status: run.status, outcome: run.outcome, reason: run.reason },
    nodes: [...nodes],
  };
}

const APPLY: Record<
  RunStreamFrame["type"],
  (state: PlanRunLiveState, frame: RunStreamFrame) => PlanRunLiveState
> = {
  agent_event: (state) => state,
  catchup_complete: (state) => state,
  ci_check: (state) => state,
  task_event: (state) => state,
  node_status: nodeStatusBranch(),
  run_status: ifFrame("run_status", (state, frame) => ({
    ...state,
    run: runStatusFacts(frame),
  })),
};

/** A fresh server render replaces the whole fold — a server action (Approve, Regenerate, …) revalidated the page with a new seed, which outranks anything the socket folded in from the run that seed already reflects. */
export interface PlanRunLiveReset {
  type: "reset";
  run: PlanRunLiveFacts;
  nodes: readonly AssemblyRunNode[];
}

export type PlanRunLiveAction = RunStreamFrame | PlanRunLiveReset;

/** Applies one frame, or resets to a freshly server-rendered seed. */
export function reducePlanRunLive(
  state: PlanRunLiveState,
  action: PlanRunLiveAction,
): PlanRunLiveState {
  if (action.type === "reset") {
    return initialPlanRunLive(action.run, action.nodes);
  }

  return APPLY[action.type](state, action);
}
