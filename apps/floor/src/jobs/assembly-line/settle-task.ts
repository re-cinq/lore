// Closing the books on an assembly line's backing task.
//
// `finishLine` closes the run row and reclaims the token, but nothing wrote back to
// pipeline.tasks: an assembly-line-backed task sat at `running` with a NULL
// failure_reason forever, because the agent-watcher's post-completion handling
// returns early for node CRs (they carry the assembly-line-id label) and only the
// synchronous Docker path ever ran finalizeStationRun. A feature-planning round
// that died in its init container therefore surfaced in the wizard as an endless
// spinner, then a canned guess about ANTHROPIC_API_KEY.
//
// This is the cluster-path twin of finalizeStationRun's checks: the decision is
// pure, the writes are CAS so a losing racer is a no-op.

import type { PipelineTask } from "@re-cinq/lore-shared";
import type { Features } from "@re-cinq/lore-shared/project/features/features.js";
import { revertFeatureAfterFailure } from "../task/finalize-station-run.js";

/** Task statuses a terminal line may still settle. Anything else (pr-created,
 *  completed, failed, cancelled, merged) is already decided by a path that knows
 *  more than the walk does. */
const SETTLEABLE = new Set(["pending", "queued", "running"]);

export interface TaskSettlement {
  status: "completed" | "failed";
  failureReason?: string;
}

export interface SettleTaskDeps {
  tasks: {
    getById(id: string): Promise<PipelineTask | null>;
    setStatusIf(
      id: string,
      expectedStatus: string,
      status: string,
      extra?: Record<string, unknown>,
    ): Promise<boolean>;
    recordEvent(
      id: string,
      fromStatus: string | null,
      toStatus: string | null,
      meta?: Record<string, unknown>,
    ): Promise<void>;
  };
  featuresFor(repo: string): Promise<{ features: Features }>;
}

/** What a terminal line means for its task. null = leave it alone: the task is
 *  past settling, or the line deferred to the run that actually holds the branch. */
export function decideTaskSettlement(input: {
  outcome: string;
  reason?: string;
  taskStatus: string;
}): TaskSettlement | null {
  if (!SETTLEABLE.has(input.taskStatus) || input.outcome === "lease_held") {
    return null;
  }

  if (input.outcome === "completed") {
    return { status: "completed" };
  }

  return {
    status: "failed",
    failureReason: input.reason ?? `assembly line ${input.outcome}`,
  };
}

/** Mirrors the synchronous Docker path's wording (finalizeStationRun) so a round
 *  reads the same however it ran. */
export const NO_RESULT_REASON =
  "The planning run finished but posted no result — the agent did not produce a result.json the container could POST.";

/**
 * A planning round is only finished when its GapResult actually landed — the pod
 * POSTs it to the features API itself, so a line that ended (however it ended)
 * without one leaves the iteration stuck `running` and the wizard spinning. Mark
 * it failed and drop the feature back per revertFeatureAfterFailure's rule.
 *
 * Returns true when the round produced nothing usable, so the caller can fail the
 * TASK too: a `completed` task over a resultless round is the exact shape that sent
 * the wizard back to guessing, since it leaves no failure_reason to show.
 */
async function settlePlanningRound(
  task: PipelineTask,
  deps: SettleTaskDeps,
): Promise<boolean> {
  const featureId = task.context_bundle?.feature_id as string | undefined;
  const iteration = task.context_bundle?.iteration as number | undefined;

  if (!featureId || iteration == null) {
    return false;
  }
  const { features } = await deps.featuresFor(task.target_repo ?? "");
  const feature = await features.get(featureId);
  const round = feature?.iterations.find((i) => i.iteration === iteration);

  if (round?.status === "ready" && round.gap_result) {
    return false;
  }

  await features
    .setIterationResult(featureId, iteration, null, "failed")
    .catch(() => {});
  await revertFeatureAfterFailure({ features }, featureId);

  return true;
}

/** The objection a finalize line's `analyse` node raised, if it raised one. Scoped
 *  to feature-finalize: the arg belongs to that line, and a task of another type
 *  must never settle on a stray key. */
function specAnalysisObjection(
  task: PipelineTask,
  args: Record<string, unknown> | undefined,
): string | null {
  if (task.task_type !== "feature-finalize") {
    return null;
  }
  const objection = args?.spec_analysis_objection;

  return typeof objection === "string" && objection.trim() ? objection : null;
}

/**
 * Settle the task behind a line that just reached a terminal state. Safe to call
 * for every line: task-less lines, already-settled tasks, and losing racers all
 * no-op. Never throws — a settle failure must not poison finishLine.
 */
export async function settleTaskForLine(
  row: {
    id: string;
    taskId: string | null;
    repo: string;
    /** The line's args — carries a node's objection back to the settlement. */
    args?: Record<string, unknown>;
  },
  outcome: string,
  reason: string | undefined,
  deps: SettleTaskDeps,
): Promise<void> {
  if (!row.taskId) {
    return;
  }

  try {
    const task = await deps.tasks.getById(row.taskId);

    if (!task) {
      return;
    }
    // Captured before the write: the CAS updates the row (and, in-process, the
    // very object we are holding), so reading it afterwards would report the new
    // status as the transition's origin.
    const previousStatus = task.status;
    let settlement = decideTaskSettlement({
      outcome,
      reason,
      taskStatus: previousStatus,
    });

    if (!settlement) {
      return;
    }

    // Settled BEFORE the task write: whether the round produced a result decides
    // the task's own outcome. A green line whose pod posted nothing is still a
    // failed round, and saying so here is the difference between the wizard
    // showing the cause and falling back to a canned guess. (A losing racer may
    // repeat this write; it is the same value, so it is idempotent.)
    if (task.task_type === "feature-planning") {
      const noResult = await settlePlanningRound(task, deps);

      if (noResult && settlement.status === "completed") {
        settlement = { status: "failed", failureReason: NO_RESULT_REASON };
      }
    }
    // The spec analysis asked the AUTHOR a question rather than producing a change
    // set. The line COMPLETES — a changes_requested visit is not a failed one — so
    // without this the author presses "Create the spec PR", no PR appears, and
    // nothing says why. Failing the task with the objection puts it exactly where the
    // wizard already reads a diagnosis from.
    const objection = specAnalysisObjection(task, row.args);

    if (objection && settlement.status === "completed") {
      settlement = { status: "failed", failureReason: objection };
    }
    const won = await deps.tasks.setStatusIf(
      task.id,
      previousStatus,
      settlement.status,
      settlement.failureReason
        ? { failure_reason: settlement.failureReason }
        : {},
    );

    if (!won) {
      return;
    }
    await deps.tasks.recordEvent(task.id, previousStatus, settlement.status, {
      assembly_line_id: row.id,
      outcome,
    });
  } catch (err) {
    console.error(
      `[settle-task] line ${row.id} → task ${row.taskId}: ${(err as Error).message}`,
    );
  }
}
