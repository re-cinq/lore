import type { PlanLine } from "@re-cinq/lore-shared/project/plans/plan-run.js";

/** Why a Refine is refused while the agent has the plan. */
const AGENT_STILL_WORKING = "the planning agent is still working on this plan";

/** What a refusal reads of a line, whichever engine read it: the floor spells an open line `open` and a delivered one `success`, where Postgres says `running` and `completed`. */
export type RefinableLine = Pick<
  PlanLine,
  "status" | "outcome" | "open" | "merged" | "parkedMerged"
>;

/** Why no author waits on the plan, worded for its page: Regenerate, Retry and Reopen are each named only where the page offers them. */
export function refineRefusal(
  plan: { status: string },
  line: RefinableLine | null,
): string {
  return plan.status === "approved"
    ? approvedRefusal(line)
    : draftRefusal(line);
}

const OPEN_STATUSES = new Set(["queued", "running", "open"]);
const SUCCESS_OUTCOMES = new Set(["completed", "success"]);
// The nodes before the author: the agent drafting, the pass settling, the validate station run by hand and the findings it delivers.
const DRAFTING_NODES = new Set([
  "analyze",
  "plan-pass-end",
  "validate",
  "plan-findings",
]);

function draftRefusal(line: RefinableLine | null): string {
  if (!line) {
    return "the plan has no planning line yet; regenerate the plan to start one";
  }

  if (!OPEN_STATUSES.has(line.status)) {
    return endedRefusal(line);
  }

  if (line.parkedMerged) {
    return "the spec PR is being sent back to the author; try again in a moment";
  }

  return agentDrafting(line) ? AGENT_STILL_WORKING : reopenRefusal(line);
}

function endedRefusal(line: RefinableLine): string {
  return endedInFailure(line)
    ? "the planning line failed, so no agent is waiting to refine this plan; regenerate the plan to draft it again"
    : "the planning line has ended, so no agent is waiting to refine this plan; edit the section by hand";
}

/** As the plan page reads a closed line: it failed unless it finished with its spec-tasks filed. A line that failed is one the page offers Regenerate for, which is what makes a Refine able to start its own round instead. */
export function endedInFailure(line: RefinableLine): boolean {
  return (
    line.status === "failed" ||
    !SUCCESS_OUTCOMES.has(line.outcome ?? "completed")
  );
}

// On the draft itself, or between two nodes before any spec PR merged.
function agentDrafting(line: RefinableLine): boolean {
  return (
    (line.open !== null && DRAFTING_NODES.has(line.open)) ||
    (line.open === null && !line.merged)
  );
}

const APPROVED_RETRY =
  "the plan is approved and its spec work failed; retry the spec work, or reopen the plan to write again";
const APPROVED_REOPEN =
  "the plan is approved, so its sections are settled; reopen the plan to write again";

// An approved plan is read-only, so its page offers Reopen, and Retry once the spec work failed; while the spec work runs, neither.
function approvedRefusal(line: RefinableLine | null): string {
  if (line && OPEN_STATUSES.has(line.status)) {
    return line.parkedMerged ? APPROVED_REOPEN : reopenRefusal(line);
  }

  return !line || endedInFailure(line) ? APPROVED_RETRY : APPROVED_REOPEN;
}

export function reopenRefusal(line: Pick<PlanLine, "merged">): string {
  return line.merged
    ? "wait until the spec-tasks are filed"
    : "the specs are being written; wait for the spec PR";
}
