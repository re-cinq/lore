import type { PgPool } from "../../memory-store.js";
import type { PipelineTask } from "../../types.js";
import type { TaskStorePort, TaskAction, TaskTransitionMeta } from "./task-store-port.js";

/**
 * TaskStorePort over the pipeline.tasks table. The three views group the
 * existing TaskStatus union; reads are plain SELECTs. transition applies the
 * minimal status update — richer claim/cancel semantics are relocated from
 * mcp-server during migration.
 */

const PENDING_STATUSES = ["pending", "queued", "awaiting_approval"];
const RUNNING_STATUSES = ["running", "running-local", "review", "pr-created"];
const EXECUTED_STATUSES = ["completed", "merged", "failed", "cancelled"];

const NEXT_STATUS: Record<TaskAction, string> = {
  claim: "running-local",
  cancel: "cancelled",
  retry: "retried",
};

export class PgTaskStore implements TaskStorePort {
  constructor(private readonly pool: PgPool) {}

  pending(repo: string): Promise<PipelineTask[]> {
    return this.byStatus(repo, PENDING_STATUSES);
  }

  running(repo: string): Promise<PipelineTask[]> {
    return this.byStatus(repo, RUNNING_STATUSES);
  }

  executed(repo: string): Promise<PipelineTask[]> {
    return this.byStatus(repo, EXECUTED_STATUSES);
  }

  async getById(id: string): Promise<PipelineTask | null> {
    const { rows } = await this.pool.query("SELECT * FROM pipeline.tasks WHERE id = $1", [id]);
    return (rows[0] as PipelineTask) ?? null;
  }

  async transition(id: string, action: TaskAction, meta?: TaskTransitionMeta): Promise<PipelineTask> {
    const claimedBy = action === "claim" ? meta?.agentId ?? null : null;
    const { rows } = await this.pool.query(
      `UPDATE pipeline.tasks
         SET status = $2,
             claimed_by = COALESCE($3, claimed_by),
             updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, NEXT_STATUS[action], claimedBy],
    );
    return rows[0] as PipelineTask;
  }

  private async byStatus(repo: string, statuses: string[]): Promise<PipelineTask[]> {
    const { rows } = await this.pool.query(
      "SELECT * FROM pipeline.tasks WHERE target_repo = $1 AND status = ANY($2) ORDER BY created_at DESC",
      [repo, statuses],
    );
    return rows as PipelineTask[];
  }
}
