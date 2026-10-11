// The merge line's stations on the external floor (specs/external-floor FR10): one per step, all the same handle around the step logic the Postgres-walked line already runs.
import {
  defineStation,
  type Handle,
  type RunningStation,
} from "@re-cinq/floor-station";
import {
  MERGE_STEPS,
  runMergeStep,
  type MergeStep,
  type MergeStepDeps,
} from "./merge-step.js";
import { mergeStepProductionDeps } from "./run.js";

/** `resume-planning` resumes a planning run parked in Postgres; where the floor walks this line it walks planning too, and hears of the merged spec PR itself. */
export const FLOOR_MERGE_STEPS = MERGE_STEPS.filter(
  (step) => step !== "resume-planning",
);

export function mergeStationName(step: MergeStep): string {
  return `merge-${step}`;
}

/** A failure is reported, never thrown: the line's edges decide what a failed step means, and the report is what the run page shows. `deps` is built per visit because it caches the task row it reads. */
export function mergeStepHandle(
  step: MergeStep,
  deps: () => MergeStepDeps,
): Handle {
  return async ({ needs }) => {
    try {
      await runMergeStep(step, needs.task_id, deps());

      return { outcome: "success" };
    } catch (err) {
      return { outcome: "failed", error: named(step, (err as Error).message) };
    }
  };
}

/** The reason, led by the step it came from unless it already says so. */
function named(step: MergeStep, reason: string): string {
  const lead = `merge step "${step}": `;

  return reason.startsWith(lead) ? reason : `${lead}${reason}`;
}

export function startMergeStations(): RunningStation[] {
  return FLOOR_MERGE_STEPS.map((step) =>
    defineStation(
      mergeStationName(step),
      mergeStepHandle(step, mergeStepProductionDeps),
    ),
  );
}
