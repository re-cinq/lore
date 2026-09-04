import { enforceTrue } from "../../lib/enforce.js";
import type { PipelineTask } from "../../types.js";
import { ALLOWED_TASK_COLUMNS } from "../../pipeline-tasks.js";
import {
  NEXT_STATUS,
  type TaskAction,
  type TaskTransitionMeta,
} from "./task-store-port.js";
import type { SeedStoreTask, StoredTaskEvent } from "./task-store-memory.js";

/** The status-transition surface of {@link InMemoryTaskStore} — setStatus/setStatusIf/updateStatus (+ its event trail), cancel, markMerged, and the claim/complete/fail `transition` action. Shares the SAME `tasks`/`events` arrays the main store owns. */
export class TaskTransitionStore {
  constructor(
    private readonly tasks: SeedStoreTask[],
    private readonly events: StoredTaskEvent[],
    private readonly now: () => Date,
  ) {}

  private findById(id: string): SeedStoreTask | undefined {
    return this.tasks.find((t) => t.id === id);
  }

  async setStatus(
    id: string,
    status: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    const task = this.findById(id);

    if (!task) {
      return;
    }
    task.status = status;
    task.updated_at = this.now().toISOString();

    for (const [key, value] of Object.entries(extra)) {
      // Same silent-skip gate as setTaskStatus (unlike setColumns, no throw).
      if (ALLOWED_TASK_COLUMNS.has(key)) {
        task[key] = value;
      }
    }
  }

  async setStatusIf(
    id: string,
    expectedStatus: string,
    status: string,
    extra: Record<string, unknown> = {},
  ): Promise<boolean> {
    const task = this.findById(id);

    if (!task || task.status !== expectedStatus) {
      return false;
    }
    await this.setStatus(id, status, extra);

    return true;
  }

  async updateStatus(
    id: string,
    status: string,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    const task = this.findById(id);

    if (!task) {
      return;
    }
    const oldStatus = task.status ?? null;

    await this.setStatus(id, status);
    await this.recordEvent(id, oldStatus, status, meta);
  }

  async recordEvent(
    id: string,
    fromStatus: string | null,
    toStatus: string | null,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    this.events.push({
      task_id: id,
      from_status: fromStatus,
      to_status: toStatus,
      metadata: meta ?? null,
      created_at: this.now().toISOString(),
    });
  }

  async cancel(id: string): Promise<{ task_id: string; status: string }> {
    const task = this.findById(id);

    enforceTrue(task, Error, "Task not found");
    enforceTrue(
      !["merged", "failed", "cancelled"].includes(task.status ?? ""),
      Error,
      `Cannot cancel task in ${task.status} state`,
    );
    await this.updateStatus(id, "cancelled", { cancelled_by: "user" });

    return { task_id: id, status: "cancelled" };
  }

  async markMerged(id: string): Promise<{ task_id: string; status: string }> {
    const task = this.findById(id);

    enforceTrue(task, Error, "Task not found");
    enforceTrue(
      task.status === "pr-created" || task.status === "review",
      Error,
      `Cannot mark task as merged from ${task.status} state (expected pr-created or review)`,
    );
    await this.updateStatus(id, "merged", { merged_by: "manual" });

    return { task_id: id, status: "merged" };
  }

  async transition(
    id: string,
    action: TaskAction,
    meta?: TaskTransitionMeta,
  ): Promise<PipelineTask> {
    const task = this.findById(id);

    if (!task) {
      // Mirrors the Pg `rows[0] as PipelineTask` on a no-match UPDATE.
      return undefined as unknown as PipelineTask;
    }
    const claimedBy = action === "claim" ? (meta?.agentId ?? null) : null;

    task.status = NEXT_STATUS[action];
    // claimed_by = COALESCE($3, claimed_by)
    task.claimed_by = claimedBy ?? task.claimed_by;
    task.updated_at = this.now().toISOString();

    return task as unknown as PipelineTask;
  }
}
