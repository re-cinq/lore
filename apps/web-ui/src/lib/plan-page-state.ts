import { isDraftingPlan } from "./plan-run-phase";

/** What the plan page is for right now: derived from the plan's status and where its planning run is, so every control on the page reads one fact. */
export type PlanPageState =
  | "drafting"
  | "writing"
  | "validating"
  | "refining"
  | "reopened"
  | "spec-work"
  | "spec-pr-open"
  | "question"
  | "answering"
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

// What the open node makes a draft, where that node alone says it.
const DRAFT_STATES: Partial<Record<string, PlanPageState>> = {
  analyze: "refining",
  validate: "validating",
  "plan-findings": "validating",
};

function draftState(run: RunFacts): PlanPageState {
  if (isDraftingPlan(run, run.nodes)) {
    return "drafting";
  }
  const open = openNode(run.nodes);

  if (open === "author") {
    return authorState(run);
  }

  // With nothing open the draft is one reopened after its line delivered, and the spec PR that line merged is what the next approval amends.
  return open ? (DRAFT_STATES[open] ?? "writing") : prState(run);
}

// The line waits on the plan's people: to answer the spec analysis's question, to revise an open spec PR, or to write.
function authorState(run: RunFacts): PlanPageState {
  if (askedBySpecAnalysis(run.nodes)) {
    return "answering";
  }

  return prState(run);
}

// A spec PR the plan already has is what makes the draft a reopened one rather than one still being written.
function prState(run: RunFacts): PlanPageState {
  return run.prUrl ? "reopened" : "writing";
}

// The line reopens the plan when the spec analysis sends it back to the author (specs/7-feature-planning FR-18), so a draft can be waiting on an answer to that question.
function askedBySpecAnalysis(visits: readonly Visit[]): boolean {
  const last = visits.filter((visit) => visit.outcome !== null).at(-1);

  return (
    last?.nodeId === "analyse-specs" && last.outcome === "changes_requested"
  );
}

// A closed run either delivered the spec-tasks or fell short; an open one is on the node that names its state.
function approvedState(run: RunFacts): PlanPageState {
  if (run.status === "failed" || run.status === "finished") {
    return run.outcome === "completed" ? "delivered" : "spec-work-failed";
  }

  return openApprovedState(run.nodes);
}

// The author node is open on an approved plan in two moments: the spec analysis sent the line back with a question, or the approval landed a beat ago and the resume has not moved the line yet. Only the first has a question to show.
function openApprovedState(visits: readonly Visit[]): PlanPageState {
  const open = openNode(visits);

  if (open === "author") {
    return askedBySpecAnalysis(visits) ? "question" : "spec-work";
  }

  return (open ? APPROVED_STATES[open] : undefined) ?? "spec-work";
}

function openNode(visits: readonly Visit[]): string | undefined {
  const open = visits.filter((visit) => visit.outcome === null);

  return open.at(-1)?.nodeId;
}
