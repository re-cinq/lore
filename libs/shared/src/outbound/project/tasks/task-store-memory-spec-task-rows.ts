import type { ExistingSpecTask } from "../../../domain/feature-planning/spec-task-reconcile.js";
import type {
  SpecTaskInput,
  SpecTaskRows,
} from "./spec-task-reconcile-store.js";
import type { CreateTaskInput } from "./task-store-port.js";
import type { SeedStoreTask } from "./task-store-memory.js";

/** {@link SpecTaskRows} over the in-memory store's rows — the behavioural spec of the Pg reconcile. */
export class MemorySpecTaskRows implements SpecTaskRows {
  constructor(
    private readonly tasks: SeedStoreTask[],
    readonly create: (input: CreateTaskInput) => Promise<{ task_id: string }>,
    private readonly now: () => Date,
  ) {}

  async planSpecTasks(
    repo: string,
    { planId, groupId }: { planId?: string; groupId?: string },
  ): Promise<ExistingSpecTask[]> {
    return this.tasks
      .filter((t) => t.task_type === "spec-task" && t.target_repo === repo)
      .filter(
        (t) =>
          (planId !== undefined && t.context_bundle?.plan_id === planId) ||
          (groupId !== undefined && t.task_group_id === groupId),
      )
      .map((t) => ({
        id: t.id,
        status: t.status ?? "pending",
        issueNumber: t.issue_number ?? null,
        specTaskId: t.context_bundle?.spec_task_id as string | undefined,
        ...(t.description !== undefined ? { description: t.description } : {}),
      }));
  }

  async update(id: string, input: SpecTaskInput): Promise<void> {
    const task = this.row(id);

    Object.assign(task, {
      description: input.description,
      context_bundle: input.contextBundle ?? null,
      issue_number: input.issueNumber,
      issue_url: input.issueUrl ?? null,
      task_group_id: input.taskGroupId ?? task.task_group_id,
      updated_at: this.now().toISOString(),
    });
  }

  async requeue(id: string, input: SpecTaskInput): Promise<void> {
    await this.update(id, input);
    Object.assign(this.row(id), { status: "pending", failure_reason: null });
  }

  async cancel(id: string): Promise<void> {
    Object.assign(this.row(id), {
      status: "cancelled",
      updated_at: this.now().toISOString(),
    });
  }

  private row(id: string): SeedStoreTask {
    return this.tasks.find((t) => t.id === id) as SeedStoreTask;
  }
}
