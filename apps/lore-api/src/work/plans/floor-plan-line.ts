// A plan's planning line on the external floor (ADR-049): the same verbs planning-line.ts answers on Postgres, each a read of the plan's run and a report or start on the floor.

import type { FloorClient } from "@re-cinq/floor-client";
import {
  floorPlanLineState,
  type ParkedVisit,
  type PlanLineFloor,
  type FloorPlanLine,
} from "@re-cinq/lore-shared/feature-planning/floor-plan-runs.js";
import {
  fileItem,
  floorRepoOf,
  gitItem,
  valueItem,
} from "@re-cinq/lore-shared/floor/floor-items.js";
import { reportToVisit } from "@re-cinq/lore-shared/floor/floor-report.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { PLANNING_DEFINITION } from "@re-cinq/lore-shared/project/plans/plan-run.js";
import type { CitablePlan } from "@re-cinq/lore-shared/feature-planning/plan-coverage.js";
import { startLine } from "@re-cinq/lore-shared/review/floor-line-start.js";
import {
  openPrBrief,
  revisedBrief,
  type RefineRequest,
} from "./plan-briefs.js";
import type { PlanSubject } from "./plan-engine.js";
import {
  NOT_APPROVED,
  SPEC_WORK_ENTRY,
  SPEC_WORK_RUNNING,
  approvalDecisionOf,
  reopenTargetOf,
  type ApprovalDecision,
  type PlanRef,
  type SpecPrState,
} from "./planning-line.js";
import { AGENT_STILL_WORKING, refineRefusal } from "./refine-refusal.js";
import { askNode } from "../floor/run-node-by-hand.js";
import type { RefineAsk } from "./refine-asks.js";
import { type SpecReviewReads } from "./spec-rework.js";
import { storeCitable, storeMarkdown } from "./plan-blobs.js";

/** The node whose agent refines a section, and the start event it declares. */
const ANALYZE_NODE = "analyze";
const ANALYZE_EVENT = `node.${ANALYZE_NODE}.start`;

export interface PlanFloor extends PlanLineFloor {
  lines: Pick<FloorClient["lines"], "start">;
  events: Pick<FloorClient["events"], "post">;
  blobs: Pick<FloorClient["blobs"], "put">;
}

export interface FloorPlanDeps {
  floor: PlanFloor;
  /** The plan's spec branch, made when missing: the branch the run is started on, which `spec-write` pushes and the spec PR opens from. */
  specBranch(plan: PlanRef): Promise<string>;
  /** The repository's default branch, which the nodes after the spec PR merges clone. */
  baseBranch(plan: PlanRef): Promise<string>;
  /** What GitHub says of a spec PR now, so a later pass is briefed as the amendment it is; null when the PR is gone. */
  specPrState(repo: string, prNumber: number): Promise<SpecPrState>;
  pulls: SpecReviewReads;
  /** Writes the pending Refine down, where the agent and `plan-pass-end` read it. */
  recordRefineAsk(ask: RefineAsk): Promise<void>;
}

export interface FloorPlanMarkdown {
  plan: PlanSubject;
  planMarkdown: string;
  /** The blocks a spec statement must cite, read from the same plan as the markdown; absent where the deployment names no web UI to link them under. */
  citablePlan?: CitablePlan;
  /** What this round asks for, as the agent is told it: the draft's own brief, the section a Refine names, or which spec pass this is. Reading the plan cannot tell an agent which of its sections a person just clicked. */
  brief: string;
  /** The issue number of the user story this plan answers, when the request names one; a round that names none keeps the one its plan's last run carried. */
  storyIssue?: number;
}

export interface FloorRefineInput extends FloorPlanMarkdown {
  refine: RefineRequest;
  /** Who asked, as the floor records it on the visit the ask opens. */
  actor: string;
}

/** Drafts the plan: a run waiting on its author goes back to the agent with the edited plan and no section (a draft answers none); otherwise a run starts, or joins the one already open. The run's id either way. */
export async function startFloorDrafting(
  deps: FloorPlanDeps,
  { plan, planMarkdown, brief, storyIssue }: FloorPlanMarkdown,
): Promise<string> {
  const line = await floorPlanLineState(deps.floor, keyOf(plan));
  const planMd = await storeMarkdown(deps.floor, planMarkdown);

  if (line?.parkedAuthor) {
    await reportToVisit(deps.floor.events, line.parkedAuthor.visitId, {
      outcome: "changes_requested",
      produced: { plan_md: planMd, description: brief },
    });

    return line.lineId;
  }

  return startPlanRun(deps, line, { plan, planMd, brief, storyIssue });
}

/** Asks the planning agent to refine one section: the ask is written down and the `analyze` node is started by hand, so it needs no run waiting to take it. Refused only for an approved plan, whose sections its approval settled, and while an `analyze` visit is already open, since two agents would edit the same blocks. */
export async function askFloorRefine(
  deps: FloorPlanDeps,
  { plan, planMarkdown, brief, refine, actor }: FloorRefineInput,
): Promise<void> {
  const line = await floorPlanLineState(deps.floor, keyOf(plan));

  enforceTrue(
    plan.status !== "approved",
    apiError(409),
    refineRefusal(plan, line),
  );
  enforceTrue(line?.open !== ANALYZE_NODE, apiError(409), AGENT_STILL_WORKING);

  await deps.recordRefineAsk(askOf(plan, refine, brief));
  await (line
    ? askNode(deps.floor, { event: ANALYZE_EVENT, runId: line.lineId, actor })
    : startRunToRefine(deps, { plan, planMarkdown, brief, refine, actor }));
}

// No run to start a node on, so the ask opens one; the agent reads the ask the same way.
async function startRunToRefine(
  deps: FloorPlanDeps,
  { plan, planMarkdown, brief, refine }: FloorRefineInput,
): Promise<void> {
  await startPlanRun(deps, null, {
    plan,
    planMd: await storeMarkdown(deps.floor, planMarkdown),
    brief,
    storyIssue: refine.storyIssue,
  });
}

function askOf(plan: PlanRef, refine: RefineRequest, brief: string): RefineAsk {
  const { slot, title, baseHash, inputs, uses } = refine;

  return { planId: plan.id, slot, title, baseHash, inputs, uses, brief };
}

/** The refusal for an approval, before the plan's status flips. */
export async function decideFloorApproval(
  deps: FloorPlanDeps,
  plan: PlanSubject,
): Promise<ApprovalDecision> {
  return approvalDecisionOf(await floorPlanLineState(deps.floor, keyOf(plan)));
}

/** Moves an approved plan on: the author visit reports success with the approved plan, or with no run open a fresh run enters at the spec analysis. A run the agent is on moves nothing, and the refusal comes back as the decision. */
export async function approveFloorPlan(
  deps: FloorPlanDeps,
  input: FloorPlanMarkdown,
): Promise<ApprovalDecision> {
  const line = await floorPlanLineState(deps.floor, keyOf(input.plan));
  const decision = approvalDecisionOf(line);

  if (line?.parkedAuthor) {
    await reportApproved(deps, line.parkedAuthor, input);

    return decision;
  }

  if (decision.kind === "start-spec-work") {
    await startSpecPass(deps, line, input);
  }

  return decision;
}

/** A fresh spec pass for an approved plan whose run is not open: after a failed pass, or to revise merged specs. */
export async function startFloorSpecWork(
  deps: FloorPlanDeps,
  input: FloorPlanMarkdown,
): Promise<string> {
  const line = await floorPlanLineState(deps.floor, keyOf(input.plan));

  enforceTrue(input.plan.status === "approved", apiError(409), NOT_APPROVED);
  enforceTrue(!line || line.open === null, apiError(409), SPEC_WORK_RUNNING);

  return startSpecPass(deps, line, await amended(deps, input, line));
}

/** A pass over specs an earlier one already wrote is briefed as the amendment it is: onto the branch of a spec PR still open, or onto what reached main. A plan reaching its specs for the first time keeps the approved brief it came with. */
async function amended(
  deps: FloorPlanDeps,
  input: FloorPlanMarkdown,
  line: FloorPlanLine | null,
): Promise<FloorPlanMarkdown> {
  const prNumber = line?.prNumber ?? null;

  if (prNumber === null) {
    return input;
  }
  // Both halves come from GitHub, which is the one that knows: a spec PR can merge without its own node ever reporting it, and then the run's history would call a merged PR unmerged.
  const state = await deps.specPrState(input.plan.repo, prNumber);
  const brief = amendmentBrief(input.plan, prNumber, {
    open: state === "open",
    merged: state === "merged",
  });

  return brief === null ? input : { ...input, brief };
}

/** Which amendment a later pass is told it is making, or null when the earlier pass left nothing to amend. */
function amendmentBrief(
  plan: PlanSubject,
  prNumber: number,
  spec: { open: boolean; merged: boolean },
): string | null {
  if (spec.open) {
    return openPrBrief(plan, prNumber);
  }

  return spec.merged ? revisedBrief(plan, prNumber) : null;
}

/** Sends an open spec PR back to the author: the visit parked on `merged` reports changes_requested. A run already at its author, ended or never started needs no report. */
export async function reopenFloorPlan(
  deps: FloorPlanDeps,
  plan: PlanSubject,
): Promise<void> {
  const parked = reopenTargetOf(
    await floorPlanLineState(deps.floor, keyOf(plan)),
  );

  if (parked) {
    await reportToVisit(deps.floor.events, parked.visitId, {
      outcome: "changes_requested",
    });
  }
}

export function keyOf(plan: PlanRef): { repo: string; planId: string } {
  return { repo: plan.repo, planId: plan.id };
}

async function reportApproved(
  deps: FloorPlanDeps,
  author: ParkedVisit,
  { planMarkdown, citablePlan, brief }: FloorPlanMarkdown,
): Promise<void> {
  await reportToVisit(deps.floor.events, author.visitId, {
    outcome: "success",
    produced: {
      plan_md: await storeMarkdown(deps.floor, planMarkdown),
      ...(await storeCitable(deps.floor, citablePlan)),
      description: brief,
    },
  });
}

async function startSpecPass(
  deps: FloorPlanDeps,
  line: FloorPlanLine | null,
  { plan, planMarkdown, citablePlan, brief, storyIssue }: FloorPlanMarkdown,
): Promise<string> {
  const planMd = await storeMarkdown(deps.floor, planMarkdown);
  const { plan_blocks: planBlocks } = await storeCitable(
    deps.floor,
    citablePlan,
  );

  return startPlanRun(deps, line, {
    plan,
    planMd,
    planBlocks,
    brief,
    entry: SPEC_WORK_ENTRY,
    storyIssue,
  });
}

interface PlanRunStart {
  plan: PlanRef;
  planMd: string;
  /** The citable blocks' blob, on a spec pass whose plan came with them. */
  planBlocks?: string;
  brief: string;
  entry?: string;
  storyIssue?: number;
}

// A start that names an entry skips the nodes before it: the plan is settled, so the run opens at the spec analysis.
async function startPlanRun(
  deps: FloorPlanDeps,
  previous: FloorPlanLine | null,
  start: PlanRunStart,
): Promise<string> {
  const { plan, entry } = start;
  const storyIssue = start.storyIssue ?? previous?.storyIssue ?? undefined;
  const started = await startLine(deps.floor.lines, PLANNING_DEFINITION, {
    repo: floorRepoOf(plan.repo),
    startItems: await startItemsOf(deps, { ...start, storyIssue }),
    ...(entry ? { entry } : {}),
  });

  return started.run.id;
}

/** What a planning run is started with: the spec branch to write on, the base the nodes after the merge read, the plan, this round's brief and the user story it answers, when it names one. */
async function startItemsOf(
  deps: FloorPlanDeps,
  { plan, planMd, planBlocks, brief, storyIssue }: PlanRunStart,
): Promise<Record<string, ReturnType<typeof valueItem>>> {
  const [branch, base] = await Promise.all([
    deps.specBranch(plan),
    deps.baseBranch(plan),
  ]);

  return {
    repo: gitItem(plan.repo, branch),
    // After the spec PR merges its branch may be gone, and what it held is on the base anyway.
    base: gitItem(plan.repo, base),
    plan_id: valueItem(plan.id),
    plan_title: valueItem(plan.title),
    plan_md: fileItem(planMd),
    ...(planBlocks ? { plan_blocks: fileItem(planBlocks) } : {}),
    description: valueItem(brief),
    ...(storyIssue ? { story_issue: valueItem(String(storyIssue)) } : {}),
  };
}
