// The plan verbs that ask the floor for one node by hand (ADR-049): the validate station over a draft, the sketch agent over its Prototype section, and the spec writer again while its PR waits. Each posts the start event the node declares and answers with the run it asked.

import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  floorPlanLineState,
  type FloorPlanLine,
} from "@re-cinq/lore-shared/feature-planning/floor-plan-runs.js";
import { askNode } from "../floor/run-node-by-hand.js";
import {
  keyOf,
  startPlanRun,
  type FloorPlanDeps,
  type FloorPlanMarkdown,
  type FloorRefineInput,
} from "./floor-plan-line.js";
import type { PlanSubject } from "./plan-engine.js";
import type { RefineRequest } from "./plan-briefs.js";
import type { PlanRef } from "./planning-line.js";
import type { RefineAsk } from "./refine-asks.js";
import {
  AGENT_STILL_WORKING,
  agentHasThePlan,
  approvedRefineRefusal,
} from "./refine-refusal.js";
import { storeMarkdown } from "./plan-blobs.js";
import { PLANNING_DEFINITION } from "@re-cinq/lore-shared/project/plans/plan-run.js";
import { assertValidatable } from "./plan-validate.js";
import {
  SPEC_PR_NOT_WAITING,
  assertReworkable,
  gatherOpenReview,
} from "./spec-rework.js";

/** A node a person starts by hand: the start event it declares, and the entry a run opens at when the plan has none (the line's own entry when absent). */
export interface HandStartedNode {
  event: string;
  entry?: string;
}

/** The node whose agent refines a section. */
const ANALYZE: HandStartedNode = { event: "node.analyze.start" };

/** The node whose agent draws the Prototype section. */
const SKETCH: HandStartedNode = {
  event: "node.sketch.start",
  entry: "sketch",
};

/** The section the sketch agent owns: its Refine goes to that agent rather than the planning agent. */
const PROTOTYPE_SLOT = "prototype";

const VALIDATE_EVENT = "manual.plan.validate";
const REWRITE_EVENT = "node.rework.start";

export interface FloorPlanAsk {
  plan: PlanSubject;
  actor: string;
}

/** Runs the validate station over a draft plan parked on its author: the start event its node declares. The run's id. */
export async function validateFloorPlan(
  deps: FloorPlanDeps,
  { plan, actor }: FloorPlanAsk,
): Promise<string> {
  const line = await floorPlanLineState(deps.floor, keyOf(plan));

  assertValidatable(plan, line);

  await askNode(deps.floor, {
    event: VALIDATE_EVENT,
    runId: line.lineId,
    actor,
  });

  return line.lineId;
}

/** Runs the spec writer again in the same run while it waits on the spec PR: the floor cancels the open `merged` visit and reopens it afterwards. The run's id. */
export async function reworkFloorSpec(
  deps: FloorPlanDeps,
  { plan, actor }: FloorPlanAsk,
): Promise<string> {
  const line = await floorPlanLineState(deps.floor, keyOf(plan));

  enforceTrue(line !== null, apiError(409), SPEC_PR_NOT_WAITING);
  await gatherOpenReview(deps.pulls, assertReworkable(plan, line));

  await askNode(deps.floor, {
    event: REWRITE_EVENT,
    runId: line.lineId,
    actor,
  });

  return line.lineId;
}

/** Runs the sketch agent over the plan's Prototype section: refused as a Refine is, it starts the `sketch` node on the plan's run, or opens a run at it when the plan has none. The run's id. */
export async function sketchFloorPlan(
  deps: FloorPlanDeps,
  ask: FloorPlanMarkdown & { actor: string },
): Promise<string> {
  const line = await refinableLine(deps, ask.plan);

  return startByHand(deps, line, SKETCH, ask);
}

/** Asks the planning agent to refine one section: the ask is written down and the `analyze` node is started by hand, so it needs no run waiting to take it. Refused only for an approved plan, whose sections its approval settled, and while a drafting pass still holds the plan — `analyze`, the `plan-pass-end` that settles it, or the validation and findings someone asked for — since two agents would edit the same blocks. */
export async function askFloorRefine(
  deps: FloorPlanDeps,
  { plan, planMarkdown, brief, refine, actor }: FloorRefineInput,
): Promise<void> {
  const line = await refinableLine(deps, plan);
  const node = refine.slot === PROTOTYPE_SLOT ? SKETCH : ANALYZE;

  await deps.recordRefineAsk(askOf(plan, refine, brief));
  await startByHand(deps, line, node, { plan, planMarkdown, brief, actor });
}

/** The plan's line, once neither its approval nor a drafting pass holding it refuses a person's ask for an agent. */
export async function refinableLine(
  deps: FloorPlanDeps,
  plan: PlanSubject,
): Promise<FloorPlanLine | null> {
  const line = await floorPlanLineState(deps.floor, keyOf(plan));

  enforceTrue(
    plan.status !== "approved",
    apiError(409),
    approvedRefineRefusal(line),
  );
  enforceTrue(!agentHasThePlan(line), apiError(409), AGENT_STILL_WORKING);

  return line;
}

const OUTDATED_RUN = "redrawn on the current planning line";

/** Starts the node by hand on the plan's run, or, with no run that has the node, opens one at it; the agent reads the ask the same way. A run on a line version older than the node is cancelled first, since the floor would ignore the start and join the new run to it. The run's id. */
export async function startByHand(
  deps: FloorPlanDeps,
  line: FloorPlanLine | null,
  node: HandStartedNode,
  { actor, ...start }: FloorPlanMarkdown & { actor: string },
): Promise<string> {
  const { event, entry } = node;
  const { floor } = deps;

  if (line && (await walksNode(floor, line, node))) {
    await askNode(floor, { event, runId: line.lineId, actor });

    return line.lineId;
  }

  if (line?.status === "open") {
    await floor.runs.cancel(line.lineId, OUTDATED_RUN);
  }
  const planMd = await storeMarkdown(floor, start.planMarkdown);

  return startPlanRun(deps, line, { ...start, planMd, entry });
}

// A node with no entry of its own is on every version of the line.
async function walksNode(
  { lines }: FloorPlanDeps["floor"],
  line: FloorPlanLine,
  { entry }: HandStartedNode,
): Promise<boolean> {
  if (!entry) {
    return true;
  }
  const version = await lines.version(PLANNING_DEFINITION, line.lineHash);
  const nodes = version?.body.nodes ?? [];

  return nodes.some((node) => node.id === entry);
}

function askOf(plan: PlanRef, refine: RefineRequest, brief: string): RefineAsk {
  const { slot, title, baseHash, inputs, uses } = refine;

  return { planId: plan.id, slot, title, baseHash, inputs, uses, brief };
}
