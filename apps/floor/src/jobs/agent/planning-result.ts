// Delivering a planning round's GapResult from the pod that produced it.
//
// A feature-planning agent's deliverable is a FILE, and the subsystem streams what
// an agent says — so for a long time nothing carried the artifact back: the pod
// wrote a perfect result.json, exited 0, and the round failed with no result. The
// subsystem now raises a declared artifact as a `kind:"file"` event on the same
// NDJSON sink the Floor already receives (ai-agent-subsystem#188), so the Floor —
// which has the database — does the write. No token in the pod, no LLM in the
// delivery path.

import {
  applyGapResult,
  type GapResultFeatures,
} from "@re-cinq/lore-shared/feature-planning/apply-gap-result.js";
import type { PipelineTask } from "@re-cinq/lore-shared";
import type { AgentFileEvent } from "./agent-events.js";

/** The event name the feature-planning recipe declares in `output.watch`. Must
 *  match the recipe — the Floor routes on it. */
export const PLANNING_RESULT_EVENT = "planning.result";

export interface PlanningResultDeps {
  tasks: { getById(id: string): Promise<PipelineTask | null> };
  featuresFor(repo: string): Promise<{ features: GapResultFeatures }>;
}

/** What the delivery did, for the caller's log line and span. */
export type PlanningDelivery =
  | { outcome: "ready" }
  | { outcome: "failed"; error: string }
  | { outcome: "skipped"; error: string };

/**
 * Persist one planning artifact event. Skips anything that is not a planning
 * result, or whose task is not a planning round — the sink carries every run's
 * events, so most calls are a no-op by design.
 *
 * An artifact the agent never produced (`reason`) fails the round carrying that
 * reason, rather than leaving it to be reaped as a mystery later.
 */
export async function deliverPlanningResult(
  fileEvent: AgentFileEvent,
  deps: PlanningResultDeps,
): Promise<PlanningDelivery> {
  if (fileEvent.event !== PLANNING_RESULT_EVENT) {
    return { outcome: "skipped", error: "not a planning result" };
  }
  // The sink carries every run's artifacts, so most calls land on a task this
  // handler has no business touching.
  const task = await deps.tasks.getById(fileEvent.taskId);

  if (!task || task.task_type !== "feature-planning") {
    return { outcome: "skipped", error: "not a planning round" };
  }
  const featureId = task.context_bundle?.feature_id as string | undefined;
  const iteration = task.context_bundle?.iteration as number | undefined;

  if (!featureId || iteration == null) {
    return { outcome: "skipped", error: "planning round has no feature id" };
  }
  const { features } = await deps.featuresFor(task.target_repo ?? "");

  if (fileEvent.reason) {
    await features.setIterationResult(featureId, iteration, null, "failed");

    return {
      outcome: "failed",
      error: `the agent produced no result.json (${fileEvent.reason})`,
    };
  }

  let payload: unknown;

  try {
    payload = JSON.parse(fileEvent.content ?? "");
  } catch (err) {
    await features.setIterationResult(featureId, iteration, null, "failed");

    return {
      outcome: "failed",
      error: `result.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return applyGapResult(features, featureId, iteration, payload);
}

/** Deliver every planning artifact in one sink batch. Never throws: a delivery
 *  failure must not 500 the telemetry ingest, which also carries cost and run-viz
 *  rows for unrelated runs. Returns how many rounds it settled. */
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
      } else if (result.outcome === "failed") {
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
