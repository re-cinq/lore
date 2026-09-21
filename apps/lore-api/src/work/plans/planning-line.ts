import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import {
  findParkedAuthorNode,
  PLANNING_DEFINITION,
  type PlanningRunPort,
} from "@re-cinq/lore-shared/project/plans/plan-run.js";
import { reportToParkedNode } from "@re-cinq/lore-shared/project/assembly-runs/parked-node.js";
import {
  approvedBrief,
  draftBrief,
  refineBrief,
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

export interface DraftingInput {
  plan: { id: string; repo: string; title: string };
  projection: PlanView;
  known: string;
  createdBy: string;
}

/** Starts the plan's line with the agent's first draft; the run's args carry what its route and its PR are named from. */
export async function startDrafting(
  deps: { createTask(task: NewPlanningTask): Promise<string> },
  { plan, projection, known, createdBy }: DraftingInput,
): Promise<string> {
  return deps.createTask({
    description: draftBrief(projection, known),
    taskType: PLANNING_DEFINITION,
    targetRepo: plan.repo,
    createdBy,
    contextBundle: {
      plan_id: plan.id,
      line_args: { repo: plan.repo, plan_title: plan.title },
    },
    priority: "immediate",
  });
}

/** Sends one section back to the agent; refused while the agent is still at work, so the editor withdraws the ask. */
export async function askRefine(
  deps: ResumeDeps,
  planId: string,
  projection: PlanView,
  request: RefineRequest,
): Promise<void> {
  const { parked } = await findParkedAuthorNode(deps.runs, planId);

  enforceTrue(
    parked,
    apiError(409),
    "the planning agent is still working on this plan",
  );
  const brief = refineBrief(projection, request);

  await reportToParkedNode(deps.reporter, parked, {
    outcome: "changes_requested",
    args: { description: brief, round_feedback: brief },
  });
}

/** Moves an approved plan on to its spec work; a plan whose line is not waiting (none started, or already past approval) moves nothing. */
export async function handOverApproved(
  deps: ResumeDeps,
  planId: string,
  projection: PlanView,
): Promise<void> {
  const { parked } = await findParkedAuthorNode(deps.runs, planId);

  if (parked) {
    await reportToParkedNode(deps.reporter, parked, {
      outcome: "success",
      args: { description: approvedBrief(projection), round_feedback: null },
    });
  }
}
