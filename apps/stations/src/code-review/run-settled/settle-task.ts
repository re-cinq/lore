// What a settled run owes the `pipeline.tasks` row it was started for. A line that keeps a task keys its run on it, and nothing else tells the row the work ended: left `running`, the repository would look mid-onboarding forever and the onboard guard would refuse the next attempt.
import type { Handle } from "@re-cinq/floor-station";
import type { RunView } from "@re-cinq/floor-client";
import { ONBOARD_LINE } from "@re-cinq/lore-shared/onboard/floor-onboard.js";
import { startValueOf } from "./run-settled.js";

/** The floor lines whose runs carry a task to settle. */
const TASK_LINES: readonly string[] = [ONBOARD_LINE];

export interface TaskSettlement {
  taskId: string;
  runId: string;
  outcome: string;
  status: "completed" | "failed";
  failureReason?: string;
}

export interface SettleTaskDeps {
  run(runId: string): Promise<RunView | null>;
  settle(settlement: TaskSettlement): Promise<void>;
}

/** Settles the task of a run that has one, then lets the wrapped station do its own part. */
export function settlingTasks(deps: SettleTaskDeps, next: Handle): Handle {
  return async (brief, tools) => {
    const { line_id: lineId, run_id: runId, outcome } = brief.needs;

    if (TASK_LINES.includes(lineId)) {
      const settlement = settlementOf(await deps.run(runId), outcome);

      await (settlement && deps.settle(settlement));
    }

    return next(brief, tools);
  };
}

function settlementOf(
  run: RunView | null,
  outcome: string,
): TaskSettlement | null {
  const taskId = run && startValueOf(run, "task_id");

  if (!taskId) {
    return null;
  }
  const settled = { taskId, runId: run.id, outcome };

  return outcome === "success"
    ? { ...settled, status: "completed" }
    : {
        ...settled,
        status: "failed",
        failureReason:
          run.reason ?? `the ${run.lineId} run ended as ${outcome}`,
      };
}
