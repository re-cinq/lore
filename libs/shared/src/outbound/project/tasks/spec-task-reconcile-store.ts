import { planSpecTaskReconcile } from "../../../work/feature-planning/spec-task-reconcile.js";
import type { ExistingSpecTask } from "../../../work/feature-planning/spec-task-reconcile.js";
import type {
  CreateTaskInput,
  ReconcileSpecTasksInput,
  ReconciledSpecTasks,
} from "./task-store-port.js";

/** What each task store gives the reconcile: the plan's spec-tasks as they stand, and the three writes it applies. */
export interface SpecTaskRows {
  planSpecTasks(
    repo: string,
    key: Pick<ReconcileSpecTasksInput, "planId" | "groupId">,
  ): Promise<ExistingSpecTask[]>;
  create(input: CreateTaskInput): Promise<unknown>;
  /** Rewrites a reused spec-task from its task as filed now; `requeue` puts it back to pending. */
  refresh(
    id: string,
    input: CreateTaskInput & { issueNumber: number },
    requeue: boolean,
  ): Promise<void>;
  cancel(id: string): Promise<void>;
}

export async function reconcileSpecTasksIn(
  rows: SpecTaskRows,
  repo: string,
  input: ReconcileSpecTasksInput,
): Promise<ReconciledSpecTasks> {
  const wanted = input.tasks.map((task) => ({
    specTaskId: String(task.contextBundle?.spec_task_id),
    issueNumber: task.issueNumber,
    task,
  }));
  const plan = planSpecTaskReconcile(
    await rows.planSpecTasks(repo, input),
    wanted,
  );

  await Promise.all([
    ...plan.create.map(({ task }) =>
      rows.create({ ...task, targetRepo: repo }),
    ),
    ...plan.update.map(({ id, wanted: { task }, requeue }) =>
      rows.refresh(id, task, requeue),
    ),
    ...plan.cancel.map((id) => rows.cancel(id)),
  ]);

  return {
    created: plan.create.length,
    updated: plan.update.length,
    cancelled: plan.cancel.length,
  };
}
