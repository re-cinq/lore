import type { FloorClient } from "@re-cinq/floor-client";
import { planRunsFilter } from "@re-cinq/lore-shared/feature-planning/floor-plan-runs.js";
import {
  PLANNING_DEFINITION,
  type PlanningRunPort,
} from "@re-cinq/lore-shared/project/plans/plan-run.js";
import { planSubject } from "@re-cinq/lore-shared/project/assembly-runs/subject-keys.js";
import type { RefineRequest } from "./plan-briefs.js";
import type { ApprovalDecision, PlanRef } from "./planning-line.js";

/** Which engine walks a plan's planning line: the external floor, or the Floor this repo still runs on Postgres. */
export type PlanEngine = "floor" | "postgres";

export interface PlanEngineReads {
  /** Null on a deployment that was given no floor. */
  floor: { runs: Pick<FloorClient["runs"], "list"> } | null;
  runs: Pick<PlanningRunPort, "listForSubject">;
}

/** A plan goes to the floor when the deployment has one and either the floor already holds a run for the plan or Postgres holds no OPEN planning run for it; a plan still running on the old Floor finishes there, while one whose runs all ended moves on. */
export async function planEngineOf(
  { floor, runs }: PlanEngineReads,
  plan: { id: string; repo: string },
): Promise<PlanEngine> {
  if (!floor) {
    return "postgres";
  }

  if (await floorHoldsRun(floor, plan)) {
    return "floor";
  }

  return (await postgresHoldsRun(runs, plan.id)) ? "postgres" : "floor";
}

async function floorHoldsRun(
  floor: NonNullable<PlanEngineReads["floor"]>,
  plan: { id: string; repo: string },
): Promise<boolean> {
  const filter = planRunsFilter({ repo: plan.repo, planId: plan.id });
  const { items: held } = await floor.runs.list(filter, { limit: 1 });

  return held.length > 0;
}

/** Only a run still OPEN keeps a plan on the old engine. A plan whose runs all ended has nothing left to finish there, and counting those pinned it to the old engine for good — a plan whose last run was cancelled in September could never reach the floor, and the Refine it was offered had nothing to report to. */
async function postgresHoldsRun(
  runs: PlanEngineReads["runs"],
  planId: string,
): Promise<boolean> {
  const held = await runs.listForSubject(planSubject(planId));

  return held.some(
    (line) =>
      line.blueprintName === PLANNING_DEFINITION && OPEN_RUN.has(line.status),
  );
}

const OPEN_RUN = new Set(["queued", "running"]);

/** A plan as the routes hold it. */
export type PlanSubject = PlanRef & { status: string };

/** The drafting route's body. */
export interface DraftingRequest {
  known: string;
  createdBy: string;
}

/** What the plan routes ask of a plan's planning line, the same whichever engine holds it. Each verb answers what its route answers: a run or task id, or nothing. */
export interface PlanVerbs {
  draft(plan: PlanSubject, request: DraftingRequest): Promise<string>;
  refine(plan: PlanSubject, request: RefineRequest): Promise<void>;
  approvalDecision(plan: PlanSubject): Promise<ApprovalDecision>;
  handOverApproved(plan: PlanSubject, approvedBy: string): Promise<void>;
  reopen(plan: PlanSubject, actor: string): Promise<void>;
  openForAuthor(
    plan: PlanSubject,
    reopen: (planId: string) => Promise<unknown>,
  ): Promise<boolean>;
  startSpecWork(plan: PlanSubject, createdBy: string): Promise<string>;
  reworkSpec(plan: PlanSubject, actor: string): Promise<string>;
  validate(plan: PlanSubject, actor: string): Promise<string>;
}

/** The verbs that hand the plan's content to its line; the rest only read where the line is and report to it. */
export type PlanContentVerbs = Pick<
  PlanVerbs,
  "draft" | "refine" | "handOverApproved" | "startSpecWork"
>;
