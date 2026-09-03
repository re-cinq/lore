/**
 * Spec-task syncing, claiming, and completion.
 *
 * Pipeline-backed MCP tools for task tracking. Tasks live in pipeline.tasks with
 * task_type = 'spec-task'. The queue mechanics — DAG readiness, atomic claim,
 * completion + unblocked dependents — are single-sourced in the shared
 * TaskQueueRepository (PgTaskQueue). This module is a thin pool-binding delegate
 * plus the mcp-specific audit events.
 */

import { recordTaskEvent, type PgPool } from "@re-cinq/lore-shared";
import { PgTaskQueue } from "@re-cinq/lore-shared/project/tasks/task-queue-pg.js";

// Re-export parsing + spec-task syncing from the shared package (syncTasksToDb
// now lives in @re-cinq/lore-shared so the Floor event handler shares it).
export {
  parseTasks,
  inferPhaseDependencies,
  syncTasksToDb,
  type ParsedTask,
} from "@re-cinq/lore-shared";

/** Spec-tasks in `repo` whose every dependency is completed/merged. */
export function getReadyTasks(pool: PgPool, repo: string) {
  return new PgTaskQueue(pool).findReadySpecTasks(repo);
}

/** Atomically claim a pending spec-task; records the mcp claim audit event. */
export async function claimTask(
  pool: PgPool,
  taskId: string,
  agentId: string,
): Promise<boolean> {
  const claimed = await new PgTaskQueue(pool).claimSpecTask(taskId, agentId);

  if (claimed) {
    try {
      await recordTaskEvent(
        pool,
        taskId,
        { from: "pending", to: "running" },
        {
          agent_id: agentId,
          claimed_by: "lore_claim_task",
        },
      );
    } catch {
      /* event recording must not block */
    }
  }

  return claimed;
}

/** Mark a running spec-task completed and return newly unblocked dependents. */
export async function completeTask(pool: PgPool, taskId: string) {
  const result = await new PgTaskQueue(pool).completeSpecTask(taskId);

  if (result.completed) {
    try {
      await recordTaskEvent(
        pool,
        taskId,
        { from: "running", to: "completed" },
        {},
      );
    } catch {
      /* event recording must not block */
    }
  }

  return result;
}
