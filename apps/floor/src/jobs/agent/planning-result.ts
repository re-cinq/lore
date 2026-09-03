// Delivers a planning round's GapResult from the pod's declared `kind:"file"` artifact on the NDJSON sink (ai-agent-subsystem#188) — the Floor does the write since the pod carries no DB token.

import {
  applyGapResult,
  type GapResultFeatures,
} from "@re-cinq/lore-shared/feature-planning/apply-gap-result.js";
import type { PipelineTask } from "@re-cinq/lore-shared";
import type { AgentFileEvent } from "./agent-events.js";

/** The event name the feature-planning recipe declares in `output.watch`; must match the recipe since the Floor routes on it. */
export const PLANNING_RESULT_EVENT = "planning.result";

export interface PlanningResultDeps {
  tasks: { getById(id: string): Promise<PipelineTask | null> };
  featuresFor(repo: string): Promise<{ features: GapResultFeatures }>;
  /** The round the run's assembly line is on, when a line carries one. */
  roundOf(taskId: string): Promise<number | undefined>;
}

/** What the DELIVERY did, never the round's verdict (only settleTaskForLine records that); `failed` = a declared artifact produced none, `skipped` = not this handler's event. */
export type PlanningDelivery =
  | { outcome: "ready" }
  | { outcome: "failed"; error: string }
  | { outcome: "skipped"; error: string };

/** Persist one planning artifact event; skips non-planning-result events and non-planning-round tasks (the sink carries every run's events, so most calls are a no-op by design). */
export async function deliverPlanningResult(
  fileEvent: AgentFileEvent,
  deps: PlanningResultDeps,
): Promise<PlanningDelivery> {
  if (fileEvent.event !== PLANNING_RESULT_EVENT) {
    return { outcome: "skipped", error: "not a planning result" };
  }
  const task = await deps.tasks.getById(fileEvent.taskId);

  if (!task || task.task_type !== "feature-planning") {
    return { outcome: "skipped", error: "not a planning round" };
  }
  const featureId = task.context_bundle?.feature_id as string | undefined;
  // The LINE owns the round number: a resumed round mints no task (FR6.22), so context_bundle's iteration is stale past round 1; the task's value is only the legacy fallback.
  const iteration =
    (await deps.roundOf(fileEvent.taskId)) ??
    (task.context_bundle?.iteration as number | undefined);

  if (!featureId || iteration == null) {
    return { outcome: "skipped", error: "planning round has no feature id" };
  }
  const { features } = await deps.featuresFor(task.target_repo ?? "");

  // A failed ATTEMPT is not a failed ROUND — the analyze node's iteration_max retry can still produce a result, so settleTaskForLine remains the single owner of the round verdict.
  if (fileEvent.reason) {
    return {
      outcome: "failed",
      error: `the agent produced no result.json (${fileEvent.reason})`,
    };
  }

  let payload: unknown;

  try {
    payload = JSON.parse(fileEvent.content ?? "");
  } catch (err) {
    // Same rule as above: one owner for "this round failed".
    return {
      outcome: "failed",
      error: `result.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return applyGapResult(features, featureId, iteration, payload);
}

/** Deliver every planning artifact in one sink batch; never throws, since a delivery failure must not 500 the telemetry ingest that also carries unrelated cost/run-viz rows. Returns how many rounds it settled. */
export async function deliverPlanningResults(
  fileEvents: readonly AgentFileEvent[],
  deps: PlanningResultDeps,
): Promise<number> {
  let delivered = 0;

  for (const fileEvent of fileEvents) {
    try {
      const result = await deliverPlanningResult(fileEvent, deps);

      if (result.outcome === "ready") {
        delivered++;
      }

      if (result.outcome === "failed") {
        console.warn(
          `[planning-result] task ${fileEvent.taskId}: ${result.error}`,
        );
      }
    } catch (err) {
      console.error(
        `[planning-result] task ${fileEvent.taskId}: ${(err as Error).message}`,
      );
    }
  }

  return delivered;
}
