import type { PlanLine } from "@re-cinq/lore-shared/project/plans/plan-run.js";

/** Two agents must never edit one plan: a Refine refuses while the drafting pass still holds it. */
export const AGENT_STILL_WORKING =
  "the planning agent is still working on this plan";

/** What a refusal reads of a line, whichever engine read it: the floor spells an open line `open` and a delivered one `success`, where Postgres says `running` and `completed`. */
export type RefinableLine = Pick<PlanLine, "status" | "outcome" | "open">;

const OPEN_STATUSES = new Set(["queued", "running", "open"]);
const SUCCESS_OUTCOMES = new Set(["completed", "success"]);
// The nodes of a drafting pass: the agent writing, the pass settling, a validation someone asked for and the findings it delivers. Each of them is editing the plan, so none of them may be joined.
const DRAFTING_NODES = new Set([
  "analyze",
  "plan-pass-end",
  "validate",
  "plan-findings",
]);

/** Whether a drafting pass has the plan right now, which is the one thing that stops a Refine starting its own. */
export function agentHasThePlan(line: RefinableLine | null): boolean {
  return Boolean(line?.open && DRAFTING_NODES.has(line.open));
}

const APPROVED_RETRY =
  "the plan is approved and its spec work failed; retry the spec work, or reopen the plan to write again";
const APPROVED_REOPEN =
  "the plan is approved, so its sections are settled; reopen the plan to write again";

/** Why an approved plan's sections cannot be refined, worded for its page: it is read-only, so Reopen is offered in every state — a reopen mid spec work stops that work — and Retry once the spec work failed. A draft is never refused for where its line is, only for a pass already holding the plan, so this answers the approved half alone. */
export function approvedRefineRefusal(line: RefinableLine | null): string {
  if (line && OPEN_STATUSES.has(line.status)) {
    return APPROVED_REOPEN;
  }

  return !line || endedInFailure(line) ? APPROVED_RETRY : APPROVED_REOPEN;
}

// As the plan page reads a closed line: it failed unless it finished with its spec-tasks filed. An approved plan whose line failed is offered Retry, where one that delivered is offered Reopen.
function endedInFailure(line: RefinableLine): boolean {
  return (
    line.status === "failed" ||
    !SUCCESS_OUTCOMES.has(line.outcome ?? "completed")
  );
}
