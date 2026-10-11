import { type PlanLine } from "@re-cinq/lore-shared/project/plans/plan-run.js";
import { type ParkedTarget } from "@re-cinq/lore-shared/project/assembly-runs/parked-node.js";

/** A plan's planning line (ADR-047): the agent drafts, people refine and approve, and approval moves the plan on to its spec PR and spec-tasks. */

/** What GitHub says of a spec PR now; null when it is gone. */
export type SpecPrState = "open" | "closed" | "merged" | null;

export interface PlanRef {
  id: string;
  repo: string;
  title: string;
}

/** The node the spec work enters when a plan is approved with no line waiting on its author: the draft is settled, so the line skips it. */
export const SPEC_WORK_ENTRY = "analyse-specs";

export const NOT_APPROVED = "the plan is not approved";

export const SPEC_WORK_RUNNING = "the spec work is already running";

/** What approving the plan does to its line. */
export type ApprovalDecision =
  | { kind: "hand-over" }
  | { kind: "start-spec-work" }
  | { kind: "refused"; reason: string };

const STILL_REFINING = "the planning agent is still refining a section";
const WRITING_SPECS = "the specs are being written";

/** The decision for a line already read, whichever engine read it. */
export function approvalDecisionOf(line: PlanLine | null): ApprovalDecision {
  if (line?.parkedAuthor) {
    return { kind: "hand-over" };
  }

  if (!line || line.open === null) {
    return { kind: "start-spec-work" };
  }

  return { kind: "refused", reason: refusalFor(line.open) };
}

/** Which "not now" the approval gets. Every node before the spec analysis is still the plan being written — the planning pass, the bookkeeping after it, a validation someone asked for — and saying "the specs are being written" of any of them would name work that has not started. */
function refusalFor(open: string): string {
  return PLANNING_NODES.has(open) ? STILL_REFINING : WRITING_SPECS;
}

const PLANNING_NODES = new Set([
  "analyze",
  "plan-pass-end",
  "validate",
  "plan-findings",
]);

/** A line for `reopenActionOf`, whichever engine read it: the park it may report to is typed by that engine. */
export interface ReopenableLine<Parked extends ParkedTarget> extends Pick<
  PlanLine,
  "lineId" | "open" | "parkedAuthor" | "merged"
> {
  parkedMerged: Parked | null;
}

/** What reopening the plan does to its line. */
export type ReopenAction<Parked extends ParkedTarget> =
  | { kind: "report"; parked: Parked }
  | { kind: "cancel"; runId: string }
  | { kind: "nothing" };

/** A line waiting on the spec PR is reported to; one the spec work is on is cancelled, since the plan its people are about to rewrite is no longer the plan that work is writing specs from. A line already at the author, ended or never started needs neither. */
export function reopenActionOf<Parked extends ParkedTarget>(
  line: ReopenableLine<Parked> | null,
): ReopenAction<Parked> {
  if (!line || line.open === null || line.parkedAuthor) {
    return { kind: "nothing" };
  }

  return line.parkedMerged
    ? { kind: "report", parked: line.parkedMerged }
    : { kind: "cancel", runId: line.lineId };
}

/** `openForAuthor` for a line already read, whichever engine read it. */
export async function reopenWhenAuthorWaits(
  line: Pick<PlanLine, "parkedAuthor"> | null,
  plan: { id: string; status: string },
  reopen: (planId: string) => Promise<unknown>,
): Promise<boolean> {
  const locked = plan.status === "approved" && Boolean(line?.parkedAuthor);

  if (locked) {
    await reopen(plan.id);
  }

  return locked;
}
