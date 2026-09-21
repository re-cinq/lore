// Closing the books on an assembly line's backing task: `finishLine` reclaims the token but never wrote pipeline.tasks, leaving it stuck `running` (the wizard's endless-spinner bug); this is the cluster-path twin of finalizeStationRun's checks, pure decision + CAS writes so a losing racer is a no-op.

import type { PipelineTask } from "@re-cinq/lore-shared";

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

/** The slice of an assembly-run row a settlement reads. */
export interface SettleRow {
  id: string;
  taskId: string | null;
  repo: string;
  /** The line's args — carries a node's objection back to the settlement. */
  args?: Record<string, unknown>;
}

/** Settle the task behind a line that just reached a terminal state. Safe for every line (task-less, already-settled, losing racers all no-op); never throws — a settle failure must not poison finishLine. */
export async function settleTaskForLine(
  row: SettleRow,
  outcome: string,
  reason: string | undefined,
  deps: SettleTaskDeps,
): Promise<void> {
  if (!row.taskId) {
    return;
  }

  try {
    await settle(row, outcome, reason, deps);
  } catch (err) {
    console.error(
      `[settle-task] line ${row.id} → task ${row.taskId}: ${(err as Error).message}`,
    );
  }
}

/** Resolves what this outcome means for the task and applies it. `previousStatus` is captured BEFORE the write: the CAS mutates the very object being held, so reading it afterwards would report the new status as the transition's own origin. */
async function settle(
  row: SettleRow,
  outcome: string,
  reason: string | undefined,
  deps: SettleTaskDeps,
): Promise<void> {
  const task = row.taskId ? await deps.tasks.getById(row.taskId) : null;

  if (!task) {
    return;
  }
  const context = { task, previousStatus: task.status, outcome, reason };
  const settlement = settlementOf(context);

  if (settlement) {
    await applySettlement({ ...context, settlement, row }, deps);
  }
}

function settlementOf(context: SettlementContext): TaskSettlement | null {
  const { outcome, reason, previousStatus: taskStatus } = context;

  return decideTaskSettlement({ outcome, reason, taskStatus });
}

interface SettlementContext {
  task: PipelineTask;
  previousStatus: string;
  outcome: string;
  reason: string | undefined;
}

interface ApplySettlementContext extends SettlementContext {
  settlement: TaskSettlement;
  row: SettleRow;
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

function settlementExtra(settlement: TaskSettlement): Record<string, unknown> {
  return settlement.failureReason
    ? { failure_reason: settlement.failureReason }
    : {};
}
