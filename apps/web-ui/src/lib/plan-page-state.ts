import { isDraftingPlan } from "./plan-run-phase";

/** What the plan page is for right now: derived from the plan's status and where its planning run is, so every control on the page reads one fact. */
export type PlanPageState =
  | "drafting"
  | "writing"
  | "refining"
  | "reopened"
  | "spec-work"
  | "spec-pr-open"
  | "question"
  | "spec-work-failed"
  | "delivering"
  | "delivered";

interface Visit {
  nodeId: string;
  iteration: number;
  outcome: string | null;
}

interface RunFacts {
  status: string;
  outcome: string | null;
  prUrl: string | null;
  nodes: readonly Visit[];
}

const APPROVED_STATES: Partial<Record<string, PlanPageState>> = {
  author: "question",
  merged: "spec-pr-open",
  decompose: "delivering",
  issues: "delivering",
};

export function planPageState(
  planStatus: string,
  run: RunFacts | null,
): PlanPageState {
  if (!run) {
    return planStatus === "approved" ? "spec-work-failed" : "writing";
  }

  return planStatus === "approved" ? approvedState(run) : draftState(run);
}

function draftState(run: RunFacts): PlanPageState {
  if (isDraftingPlan(run, run.nodes)) {
    return "drafting";
  }
  const open = openNode(run.nodes);

  if (open === "analyze") {
    return "refining";
  }

  return open === "author" && run.prUrl ? "reopened" : "writing";
}

// A closed run either delivered the spec-tasks or fell short; an open one is on the node that names its state.
function approvedState(run: RunFacts): PlanPageState {
  if (run.status === "failed" || run.status === "finished") {
    return run.outcome === "completed" ? "delivered" : "spec-work-failed";
  }
  const open = openNode(run.nodes);

  return (open ? APPROVED_STATES[open] : undefined) ?? "spec-work";
}

function openNode(visits: readonly Visit[]): string | undefined {
  const open = visits.filter((visit) => visit.outcome === null);

  return open.at(-1)?.nodeId;
}
