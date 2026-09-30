import {
  planSpecTaskReconcile,
  type ExistingSpecTask,
  type SpecTaskReconcile,
} from "../../../domain/feature-planning/spec-task-reconcile.js";
import type {
  CreateTaskInput,
  ReconcileSpecTasksInput,
  ReconciledSpecTasks,
} from "./task-store-port.js";

export type SpecTaskInput = ReconcileSpecTasksInput["tasks"][number];

/** What each task store gives the reconcile: the plan's spec-tasks as they stand, and the writes it applies. */
export interface SpecTaskRows {
  planSpecTasks(
    repo: string,
    key: Pick<ReconcileSpecTasksInput, "planId" | "groupId">,
  ): Promise<ExistingSpecTask[]>;
  create(input: CreateTaskInput): Promise<unknown>;
  /** Rewrites a reused spec-task from its task as filed now, keeping its status. */
  update(id: string, input: SpecTaskInput): Promise<void>;
  /** Rewrites it and puts it back to pending. */
  requeue(id: string, input: SpecTaskInput): Promise<void>;
  cancel(id: string): Promise<void>;
}

type Wanted = {
  specTaskId: string;
  issueNumber: number;
  description: string;
  task: SpecTaskInput;
};

export async function reconcileSpecTasksIn(
  rows: SpecTaskRows,
  repo: string,
  input: ReconcileSpecTasksInput,
): Promise<ReconciledSpecTasks> {
  const plan = planSpecTaskReconcile(
    await rows.planSpecTasks(repo, input),
    input.tasks.map(wantedOf),
  );

  await applyPlan(rows, repo, plan);

  return {
    created: plan.create.length,
    updated: plan.update.length + plan.requeue.length,
    cancelled: plan.cancel.length,
  };
}

function wantedOf(task: SpecTaskInput): Wanted {
  return {
    specTaskId: String(task.contextBundle?.spec_task_id),
    issueNumber: task.issueNumber,
    description: task.description,
    task,
  };
}

async function applyPlan(
  rows: SpecTaskRows,
  repo: string,
  plan: SpecTaskReconcile<Wanted>,
): Promise<void> {
  await Promise.all([
    ...plan.create.map(({ task }) =>
      rows.create({ ...task, targetRepo: repo }),
    ),
    ...plan.update.map(({ id, wanted }) => rows.update(id, wanted.task)),
    ...plan.requeue.map(({ id, wanted }) => rows.requeue(id, wanted.task)),
    ...plan.cancel.map((id) => rows.cancel(id)),
  ]);
}
