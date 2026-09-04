// Closing the books on an assembly line's backing task: `finishLine` reclaims the token but never wrote pipeline.tasks, leaving it stuck `running` (the wizard's endless-spinner bug); this is the cluster-path twin of finalizeStationRun's checks, pure decision + CAS writes so a losing racer is a no-op.

import type { PipelineTask } from "@re-cinq/lore-shared";
import type { Features } from "@re-cinq/lore-shared/project/features/features.js";
import type { FeatureWithIterations } from "@re-cinq/lore-shared/project/features/features-port.js";
import { revertFeatureAfterFailure } from "../task/finalize-station-run.js";

/** Task statuses a terminal line may still settle; anything else is already decided by a path that knows more than the walk does. */
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

/** What a terminal line means for its task; null = leave it alone (past settling, or deferred to the run holding the branch). */
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

/** Mirrors the synchronous Docker path's wording (finalizeStationRun) so a round reads the same however it ran. */
export const NO_RESULT_REASON =
  "The planning run finished but posted no result — the agent did not produce a result.json the container could POST.";

function planningRoundContext(
  task: PipelineTask,
): { featureId: string; iteration: number } | null {
  const featureId = task.context_bundle?.feature_id as string | undefined;
  const iteration = task.context_bundle?.iteration as number | undefined;

  if (!featureId || iteration == null) {
    return null;
  }

  return { featureId, iteration };
}

function roundAlreadyReady(
  feature: FeatureWithIterations | null | undefined,
  iteration: number,
): boolean {
  const round = feature?.iterations.find((i) => i.iteration === iteration);

  return round?.status === "ready" && Boolean(round.gap_result);
}

/** A planning round is only finished when its GapResult landed (the pod POSTs it); a line that ended without one leaves the iteration stuck `running`, so mark it failed and revert the feature. Returns true when the round produced nothing usable, so the caller fails the TASK too rather than leaving no failure_reason to show. */
async function settlePlanningRound(
  task: PipelineTask,
  deps: SettleTaskDeps,
): Promise<boolean> {
  const context = planningRoundContext(task);

  if (!context) {
    return false;
  }
  const { featureId, iteration } = context;
  const { features } = await deps.featuresFor(task.target_repo ?? "");
  const feature = await features.get(featureId);

  if (roundAlreadyReady(feature, iteration)) {
    return false;
  }

  await features
    .setIterationResult(featureId, iteration, null, "failed")
    .catch(() => {});
  await revertFeatureAfterFailure({ features }, featureId);

  return true;
}

interface SettlementContext {
  task: PipelineTask;
  previousStatus: string;
  outcome: string;
  reason: string | undefined;
}

/** Decides the task's settlement, folding in the planning-round check: whether the round produced a result decides the task's own outcome, so the wizard shows the cause instead of a canned guess (idempotent if a losing racer repeats it). */
async function resolveSettlement(
  context: SettlementContext,
  deps: SettleTaskDeps,
): Promise<TaskSettlement | null> {
  const { task, previousStatus, outcome, reason } = context;
  const settlement = decideTaskSettlement({
    outcome,
    reason,
    taskStatus: previousStatus,
  });

  if (!settlement) {
    return null;
  }

  const planningNoResult =
    task.task_type === "feature-planning" &&
    (await settlePlanningRound(task, deps));

  if (planningNoResult && settlement.status === "completed") {
    return { status: "failed", failureReason: NO_RESULT_REASON };
  }

  return settlement;
}

function settlementExtra(settlement: TaskSettlement): Record<string, unknown> {
  return settlement.failureReason
    ? { failure_reason: settlement.failureReason }
    : {};
}

interface ApplySettlementContext {
  task: PipelineTask;
  previousStatus: string;
  settlement: TaskSettlement;
  row: { id: string; taskId: string | null; repo: string };
  outcome: string;
}

// No spec-analysis objection arm here any more: that's an EDGE back to the author node (FR6.26), parking on a person instead of needing a faked task failure.
async function applySettlement(
  context: ApplySettlementContext,
  deps: SettleTaskDeps,
): Promise<void> {
  const { task, previousStatus, settlement, row, outcome } = context;
  const won = await deps.tasks.setStatusIf(
    task.id,
    previousStatus,
    settlement.status,
    settlementExtra(settlement),
  );

  if (!won) {
    return;
  }
  await deps.tasks.recordEvent(task.id, previousStatus, settlement.status, {
    assembly_run_id: row.id,
    outcome,
  });
}

/** Settle the task behind a line that just reached a terminal state. Safe for every line (task-less, already-settled, losing racers all no-op); never throws — a settle failure must not poison finishLine. */
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
    // Captured before the write: the CAS mutates the very object we're holding, so reading afterwards would report the new status as the transition's origin.
    const previousStatus = task.status;
    const settlement = await resolveSettlement(
      { task, previousStatus, outcome, reason },
      deps,
    );

    if (!settlement) {
      return;
    }
    await applySettlement(
      { task, previousStatus, settlement, row, outcome },
      deps,
    );
  } catch (err) {
    console.error(
      `[settle-task] line ${row.id} → task ${row.taskId}: ${(err as Error).message}`,
    );
  }
}
