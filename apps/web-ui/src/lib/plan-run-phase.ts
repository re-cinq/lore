/** What a plan's planning run is doing, in one sentence, and whether it waits on people — the plan page's replacement for the feature wizard's phase. */
export interface PlanRunPhase {
  tone: "working" | "waiting" | "failed" | "done";
  text: string;
}

interface Visit {
  nodeId: string;
  iteration: number;
  outcome: string | null;
}

// What each node of the feature-planning line means to the plan's people while it is the open one.
const NODE_PHASES: Partial<Record<string, PlanRunPhase>> = {
  analyze: {
    tone: "working",
    text: "The planning agent is drafting the plan.",
  },
  author: {
    tone: "waiting",
    text: "Waiting for you: refine sections or approve the plan.",
  },
  "analyse-specs": {
    tone: "working",
    text: "Writing the specs from the approved plan.",
  },
  write: { tone: "working", text: "Writing the specs from the approved plan." },
  push: { tone: "working", text: "Writing the specs from the approved plan." },
  merged: {
    tone: "waiting",
    text: "The spec PR is open and waiting to be merged.",
  },
  decompose: {
    tone: "working",
    text: "Breaking the spec into stories and tasks.",
  },
  issues: {
    tone: "working",
    text: "Breaking the spec into stories and tasks.",
  },
};

const REFINING: PlanRunPhase = {
  tone: "working",
  text: "The planning agent is refining a section.",
};

interface RunState {
  status: string;
  /** How a finished run ended: `completed`, or the verdict that stopped it (`failed`, `iteration_max`, …). */
  outcome?: string | null;
  reason: string | null;
}

export function planRunPhase(
  run: RunState,
  visits: readonly Visit[],
): PlanRunPhase {
  if (endedInFailure(run)) {
    return {
      tone: "failed",
      text: `The run failed: ${run.reason ?? "no reason was recorded"}`,
    };
  }

  if (run.status === "finished") {
    return { tone: "done", text: "Done: the plan's spec-tasks are filed." };
  }

  return run.status === "queued"
    ? { tone: "waiting", text: "Waiting for a runner to pick up the draft." }
    : openNodePhase(visits);
}

// `status` only says the walk ended; a finished run failed unless its outcome says it completed.
function endedInFailure(run: RunState): boolean {
  return (
    run.status === "failed" ||
    (run.status === "finished" && (run.outcome ?? "completed") !== "completed")
  );
}

/** Whether the planning agent is still writing the first draft, which replaces whatever the plan holds now; a Refine only proposes one section, so the plan stays open then. */
export function isDraftingPlan(
  run: { status: string },
  visits: readonly Visit[],
): boolean {
  const open = openVisit(visits);
  const firstDraft = open?.nodeId === "analyze" && open.iteration === 1;

  return (
    run.status === "queued" ||
    (run.status === "running" && (visits.length === 0 || firstDraft))
  );
}

// The newest visit with no outcome yet is the node the run is on.
function openVisit(visits: readonly Visit[]): Visit | undefined {
  return visits.filter((visit) => visit.outcome === null).at(-1);
}

function openNodePhase(visits: readonly Visit[]): PlanRunPhase {
  const open = openVisit(visits);

  if (open?.nodeId === "analyze" && open.iteration > 1) {
    return REFINING;
  }

  return (
    (open && NODE_PHASES[open.nodeId]) ?? {
      tone: "working",
      text: "Moving to the next step.",
    }
  );
}
