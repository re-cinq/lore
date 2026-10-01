import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { SPEC_REVIEW_ARG } from "@re-cinq/lore-shared/review/spec-review.js";
import {
  findParkedAuthorNode,
  planLineState,
  PLANNING_DEFINITION,
  type PlanLine,
  type PlanningRunPort,
} from "@re-cinq/lore-shared/project/plans/plan-run.js";
import {
  reportToParkedNode,
  type ParkedTarget,
} from "@re-cinq/lore-shared/project/assembly-runs/parked-node.js";
import { refineRefusal, reopenRefusal } from "./refine-refusal.js";
import {
  approvedBrief,
  draftBrief,
  openPrBrief,
  refineBrief,
  revisedBrief,
  type PlanView,
  type RefineRequest,
} from "./plan-briefs.js";

/** A plan's planning line (ADR-047): the agent drafts, people refine and approve, and approval moves the plan on to its spec PR and spec-tasks. */

export interface NewPlanningTask {
  description: string;
  taskType: string;
  targetRepo: string;
  createdBy: string;
  contextBundle: Record<string, unknown>;
  priority: "immediate";
}

export interface ResumeDeps {
  runs: PlanningRunPort;
  reporter: Parameters<typeof reportToParkedNode>[0];
}

/** What GitHub says of a spec PR now; null when it is gone. */
export type SpecPrState = "open" | "closed" | "merged" | null;

export type DraftingDeps = ResumeDeps & {
  createTask(task: NewPlanningTask): Promise<string>;
};

export type SpecWorkDeps = DraftingDeps & {
  specPrState(prNumber: number): Promise<SpecPrState>;
};

export interface PlanRef {
  id: string;
  repo: string;
  title: string;
}

export interface DraftingInput {
  plan: PlanRef;
  projection: PlanView;
  known: string;
  createdBy: string;
}

/** The node the spec work enters when a plan is approved with no line waiting on its author: the draft is settled, so the line skips it. */
export const SPEC_WORK_ENTRY = "analyse-specs";

export const NOT_APPROVED = "the plan is not approved";

export const SPEC_WORK_RUNNING = "the spec work is already running";

/** Drafts the plan: a line parked on its people is sent back to the agent with the draft brief (a plan has one open line, so a new run would only join it and do nothing); otherwise a new line starts. The run's args carry what its route and its PR are named from. */
export async function startDrafting(
  deps: DraftingDeps,
  { plan, projection, known, createdBy }: DraftingInput,
): Promise<string> {
  const brief = draftBrief(projection, known);
  const { parked } = await findParkedAuthorNode(deps.runs, plan.id);

  if (parked) {
    await reportToParkedNode(deps.reporter, parked, {
      outcome: "changes_requested",
      args: { description: brief, round_feedback: brief, refine: null },
    });

    return parked.lineId;
  }

  return deps.createTask(planningTask(plan, brief, createdBy));
}

/** The spec PR an earlier pass left open, which a fresh pass contributes to: its branch, and the PR the push node must not open again. */
interface OpenSpecPr {
  prNumber: number;
  prUrl: string | null;
  branch: string | null;
}

interface TaskShape {
  entryNode?: string;
  open?: OpenSpecPr | null;
}

// A contributing task lands on the open PR's branch (the Floor honours `contextBundle.branch`).
function planningTask(
  plan: PlanRef,
  description: string,
  createdBy: string,
  shape: TaskShape = {},
): NewPlanningTask {
  const branch = shape.open?.branch;

  return {
    description,
    taskType: PLANNING_DEFINITION,
    targetRepo: plan.repo,
    createdBy,
    contextBundle: {
      plan_id: plan.id,
      ...(branch ? { branch } : {}),
      line_args: lineArgs(plan, shape),
    },
    priority: "immediate",
  };
}

// The run's args: what its route and PR are named from, where it enters the blueprint when the draft is already settled, and the open PR it contributes to, so `push` stamps nothing new.
function lineArgs(plan: PlanRef, { entryNode, open }: TaskShape) {
  return {
    repo: plan.repo,
    plan_title: plan.title,
    ...(entryNode ? { entry_node: entryNode } : {}),
    ...(open ? { pr_number: open.prNumber, pr_url: open.prUrl } : {}),
  };
}

/** Sends one section back to the agent while the line waits on its author; at any other moment it is refused with the reason, so the editor withdraws the ask and the page says why. */
export async function askRefine(
  deps: ResumeDeps,
  plan: { id: string; status: string },
  projection: PlanView,
  request: RefineRequest,
): Promise<void> {
  const line = await planLineState(deps.runs, plan.id);

  enforceTrue(line?.parkedAuthor, apiError(409), refineRefusal(plan, line));
  await reportToParkedNode(deps.reporter, line.parkedAuthor, {
    outcome: "changes_requested",
    args: refineArgs(projection, request),
  });
}

// The run records which Refine this pass answers, so the edited plan.md comes back as that section's proposal without the agent copying anything.
function refineArgs(projection: PlanView, request: RefineRequest) {
  const brief = refineBrief(projection, request);
  const { slot, baseHash, uses } = request;

  return {
    description: brief,
    round_feedback: brief,
    refine: { slot, baseHash, uses },
  };
}

/** What approving the plan does to its line. */
export type ApprovalDecision =
  | { kind: "hand-over" }
  | { kind: "start-spec-work" }
  | { kind: "refused"; reason: string };

const STILL_REFINING = "the planning agent is still refining a section";
const WRITING_SPECS = "the specs are being written";

/** Approval resumes a line waiting on its author; a plan with no open line (none yet, its spec work failed, or its specs already merged) gets a fresh spec pass; a line the agent is on is refused, since the approval would strand the plan. */
export async function decideApproval(
  runs: PlanningRunPort,
  planId: string,
): Promise<ApprovalDecision> {
  return approvalDecisionOf(await planLineState(runs, planId));
}

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

const PLANNING_NODES = new Set(["analyze", "plan-pass-end", "validate"]);

/** Moves an approved plan on to its spec work: the parked author node resumes with the approved brief, or, with no line waiting, a fresh line starts at the spec analysis. A line the agent is on moves nothing. */
export async function handOverApproved(
  deps: SpecWorkDeps,
  plan: PlanRef,
  projection: PlanView,
  approvedBy: string,
): Promise<void> {
  const line = await planLineState(deps.runs, plan.id);

  if (line?.parkedAuthor) {
    return resumeAuthor(deps, line.parkedAuthor, approvedBrief(projection));
  }

  if (!line || line.open === null) {
    await startSpecWork(deps, {
      plan,
      projection,
      createdBy: approvedBy,
      line,
    });
  }
}

async function resumeAuthor(
  deps: ResumeDeps,
  parked: ParkedTarget,
  brief: string,
): Promise<void> {
  await reportToParkedNode(deps.reporter, parked, {
    outcome: "success",
    args: { description: brief, round_feedback: null, refine: null },
  });
}

/** What a fresh spec pass is for: the approved plan, or one whose specs merged already. */
export interface SpecWorkInput {
  plan: PlanRef;
  projection: PlanView;
  createdBy: string;
  line: PlanLine | null;
}

/** A fresh spec pass for an approved plan whose line is not open, entered at the spec analysis; after a merged spec PR it is briefed as an amendment, and while the spec PR is still open the pass contributes to it — an existing spec branch is never replaced. */
export async function startSpecWork(
  deps: SpecWorkDeps,
  { plan, projection, createdBy, line }: SpecWorkInput,
): Promise<string> {
  const open = await openSpecPrOf(line, deps);

  return deps.createTask(
    planningTask(plan, specWorkBrief(projection, line, open), createdBy, {
      entryNode: SPEC_WORK_ENTRY,
      open,
    }),
  );
}

// An ended line whose spec PR is still open on GitHub: the Retry of a failed pass, or a cancelled one. A PR closed without merging is gone — contributing to it would push specs no PR shows and park the line on a merge that never comes.
async function openSpecPrOf(
  line: PlanLine | null,
  deps: Pick<SpecWorkDeps, "specPrState">,
): Promise<OpenSpecPr | null> {
  if (!line || line.prNumber === null || line.merged) {
    return null;
  }

  return (await deps.specPrState(line.prNumber)) === "open"
    ? { prNumber: line.prNumber, prUrl: line.prUrl, branch: line.branch }
    : null;
}

function specWorkBrief(
  projection: PlanView,
  line: PlanLine | null,
  open: OpenSpecPr | null,
): string {
  if (open) {
    return openPrBrief(projection, open.prNumber);
  }

  return line?.merged && line.prNumber !== null
    ? revisedBrief(projection, line.prNumber)
    : approvedBrief(projection);
}

/** Reopening an approved plan sends its open spec PR back to the author (the `merged → author` edge's only reporter); a line already waiting on the author, ended, or never started needs no report. A line the spec work is on is refused, since reopening would race it. */
export async function reopenPlan(
  deps: ResumeDeps,
  planId: string,
  actor: string,
): Promise<void> {
  const parked = reopenTargetOf(await planLineState(deps.runs, planId));

  if (parked) {
    await reportToParkedNode(deps.reporter, parked, {
      outcome: "changes_requested",
      args: {
        round_feedback: `${actor} reopened the plan to revise it`,
        refine: null,
        [SPEC_REVIEW_ARG]: null,
      },
    });
  }
}

/** A line for `reopenTargetOf`, whichever engine read it: the park it may report to is typed by that engine. */
export interface ReopenableLine<Parked extends ParkedTarget> extends Pick<
  PlanLine,
  "open" | "parkedAuthor" | "merged"
> {
  parkedMerged: Parked | null;
}

/** The spec-PR park a reopen reports to; null when the line needs no report. A line the spec work is on is refused. */
export function reopenTargetOf<Parked extends ParkedTarget>(
  line: ReopenableLine<Parked> | null,
): Parked | null {
  if (!line || line.open === null || line.parkedAuthor) {
    return null;
  }
  enforceTrue(line.parkedMerged, apiError(409), reopenRefusal(line));

  return line.parkedMerged;
}

/** A line waiting on its author means the plan is open for writing: an approved plan whose line came back to the author (the spec analysis asked something, or someone ran the station by hand) is reopened, since its read-only editor would leave nobody able to answer. True when it reopened the plan. */
export async function openForAuthor(
  runs: PlanningRunPort,
  plan: { id: string; status: string },
  reopen: (planId: string) => Promise<unknown>,
): Promise<boolean> {
  return reopenWhenAuthorWaits(
    await planLineState(runs, plan.id),
    plan,
    reopen,
  );
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
