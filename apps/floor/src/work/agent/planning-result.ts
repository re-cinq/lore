// Moves the planning agent's plan.md between lore-api and its pod (ADR-047): the pod downloads the live plan before it starts and hands the edited file back, and the Floor carries both because the pod holds no API token. The refine context comes from the run, never from the agent.

import type { AgentFileEvent } from "./agent-events.js";
import type {
  PlanRunRef,
  PlanWriter,
  RefineContext,
} from "../../domain/plan-writer.js";

export type {
  PlanRunRef,
  PlanWriter,
  RefineContext,
} from "../../domain/plan-writer.js";

/** The event name the feature-planning recipe declares in `output.watch`; must match the recipe since the Floor routes on it. */
export const PLANNING_RESULT_EVENT = "planning.result";

/** Who the plan's people see writing. */
export const PLANNING_ACTOR = "planning-agent";

export interface PlanningResultDeps {
  /** The plan the task's open planning run works on, and the Refine it answers when it answers one. */
  planRunOfTask(taskId: string): Promise<PlanRunRef | undefined>;
  plans: PlanWriter;
}

export interface PlanUploadDeps {
  /** The plan run of the pod an Agent CR name belongs to. */
  planRunOfAgent(agentCrName: string): Promise<PlanRunRef | undefined>;
  plans: PlanWriter;
}

export interface PlanFileDeps {
  planOfRun(assemblyRunId: string): Promise<string | undefined>;
  plans: PlanWriter;
}

/** What the DELIVERY did, never the round's verdict; `failed` = the agent's file could not be written, `skipped` = not this handler's to write. */
export type PlanningDelivery =
  | { outcome: "ready" }
  | { outcome: "failed"; error: string }
  | { outcome: "skipped"; error: string };

const NO_PLAN: PlanningDelivery = {
  outcome: "skipped",
  error: "the run names no plan",
};

/** The plan and Refine a planning run's args carry; undefined for a run that drafts no plan. A malformed refine reads as a draft rather than a proposal nobody asked for. */
export function planRunRefOf(
  args: Readonly<Record<string, unknown>>,
): PlanRunRef | undefined {
  const planId = args.plan_id;

  return typeof planId === "string"
    ? { planId, refine: refineOf(args.refine) }
    : undefined;
}

function refineOf(value: unknown): RefineContext | null {
  const refine = (value ?? {}) as Partial<RefineContext>;

  return typeof refine.slot === "string" && typeof refine.baseHash === "string"
    ? { slot: refine.slot, baseHash: refine.baseHash, uses: refine.uses }
    : null;
}

/** The plan.md a pod downloads for its run, rendered from the live plan at the moment it asks; null when the run drafts no plan. */
export async function planFileOf(
  assemblyRunId: string,
  deps: PlanFileDeps,
): Promise<string | null> {
  const planId = await deps.planOfRun(assemblyRunId);

  return planId ? deps.plans.markdownOf(planId) : null;
}

/** A plan.md the supervisor uploaded: written into the plan the agent's run drafts, as a draft or as its Refine's proposal. */
export async function receivePlanUpload(
  agentCrName: string,
  markdown: string,
  deps: PlanUploadDeps,
): Promise<PlanningDelivery> {
  const run = await deps.planRunOfAgent(agentCrName);

  return run ? submit(run, markdown, deps.plans) : NO_PLAN;
}

/** A planning file event from the sink. An uploaded file was already written by its upload, so its event is only the notice; an inline one (a cluster with no files endpoint) is written here. */
export async function deliverPlanningResult(
  fileEvent: AgentFileEvent,
  deps: PlanningResultDeps,
): Promise<PlanningDelivery> {
  if (fileEvent.event !== PLANNING_RESULT_EVENT) {
    return { outcome: "skipped", error: "not a planning result" };
  }

  if (fileEvent.uploaded) {
    return { outcome: "skipped", error: "delivered by upload" };
  }
  const run = await deps.planRunOfTask(fileEvent.taskId);

  if (!run) {
    return NO_PLAN;
  }

  return fileEvent.content === null
    ? {
        outcome: "failed",
        error: `the agent produced no plan.md (${fileEvent.reason ?? "no reason"})`,
      }
    : submit(run, fileEvent.content, deps.plans);
}

async function submit(
  run: PlanRunRef,
  markdown: string,
  plans: PlanWriter,
): Promise<PlanningDelivery> {
  await plans.submitFile(run.planId, {
    actor: PLANNING_ACTOR,
    markdown,
    refine: run.refine,
  });

  return { outcome: "ready" };
}

/** Deliver every planning artifact in one sink batch; never throws, since a delivery failure must not 500 the telemetry ingest that also carries unrelated cost/run-viz rows. Returns how many it wrote. */
export async function deliverPlanningResults(
  fileEvents: readonly AgentFileEvent[],
  deps: PlanningResultDeps,
): Promise<number> {
  let delivered = 0;

  for (const fileEvent of fileEvents) {
    delivered += await deliverAndReport(fileEvent, deps);
  }

  return delivered;
}

async function deliverAndReport(
  fileEvent: AgentFileEvent,
  deps: PlanningResultDeps,
): Promise<number> {
  try {
    const result = await deliverPlanningResult(fileEvent, deps);

    if (result.outcome === "failed") {
      console.warn(
        `[planning-result] task ${fileEvent.taskId}: ${result.error}`,
      );
    }

    return result.outcome === "ready" ? 1 : 0;
  } catch (err) {
    console.error(
      `[planning-result] task ${fileEvent.taskId}: ${(err as Error).message}`,
    );

    return 0;
  }
}
