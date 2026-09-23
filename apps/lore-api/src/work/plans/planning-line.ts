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

/** Drafts the plan: a line parked on its people is sent back to the agent with the draft brief (a plan has one open line, so a new run would only join it and do nothing); otherwise a new line starts. The run's args carry what its route and its PR are named from. */
export async function startDrafting(
  deps: ResumeDeps & { createTask(task: NewPlanningTask): Promise<string> },
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

function planningTask(
  plan: DraftingInput["plan"],
  description: string,
  createdBy: string,
): NewPlanningTask {
  return {
    description,
    taskType: PLANNING_DEFINITION,
    targetRepo: plan.repo,
    createdBy,
    contextBundle: {
      plan_id: plan.id,
      line_args: { repo: plan.repo, plan_title: plan.title },
    },
    priority: "immediate",
  };
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
  await reportToParkedNode(deps.reporter, parked, {
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
      args: {
        description: approvedBrief(projection),
        round_feedback: null,
        refine: null,
      },
    });
  }
}
