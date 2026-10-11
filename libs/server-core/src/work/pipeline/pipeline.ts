import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
/** Pipeline task CRUD with mcp-specific policy (trust-gate + the default repo). */

import {
  createPipelineTask,
  retryPipelineTask,
  getPipelineTask,
  listPipelineTasks,
  recordTaskEvent,
  updateTaskStatus as sharedUpdateTaskStatus,
  cancelPipelineTask,
  markTaskMerged as sharedMarkTaskMerged,
  type CreateTaskInput,
  type PipelineTaskRow,
  type TaskListRow,
} from "@re-cinq/lore-shared";

// ── Pool management ──────────────────────────────────────────────────

import type { Pool } from "pg";

let pool: Pool | null = null;

function getPool(): Pool {
  enforceTrue(pool, Error, "Pipeline database not configured");

  return pool;
}

export function setPipelinePool(p: Pool): void {
  pool = p;
}

// ── Relocated CRUD (single source in shared; thin pool-binding wrappers) ──
export const getTask = (
  taskId: string,
): Promise<(PipelineTaskRow & { events: Record<string, unknown>[] }) | null> =>
  getPipelineTask(getPool(), taskId);
export const listTasks = (
  status?: string,
  limit = 50,
  offset = 0,
): Promise<{ tasks: TaskListRow[]; total: number }> =>
  listPipelineTasks(getPool(), status, limit, offset);
export const recordEvent = (
  taskId: string,
  fromStatus: string | null,
  toStatus: string | null,
  meta?: Record<string, unknown>,
) =>
  recordTaskEvent(getPool(), taskId, { from: fromStatus, to: toStatus }, meta);
export const updateTaskStatus = (
  taskId: string,
  newStatus: string,
  meta?: Record<string, unknown>,
) => sharedUpdateTaskStatus(getPool(), taskId, newStatus, meta);
export const cancelTask = (taskId: string) =>
  cancelPipelineTask(getPool(), taskId);
export const markTaskMerged = (taskId: string) =>
  sharedMarkTaskMerged(getPool(), taskId);

// ── Task CRUD ────────────────────────────────────────────────────────

// createTask single-sourced in shared; mcp adds trust-gate + default repo resolve.
export type { CreateTaskInput } from "@re-cinq/lore-shared";

// Where a task that names no repo goes; every task type shared this one default.
const DEFAULT_TARGET_REPO = "re-cinq/lore";

export function createTask(
  input: CreateTaskInput,
): Promise<Awaited<ReturnType<typeof createPipelineTask>>> {
  return createPipelineTask(getPool(), {
    ...input,
    // The pipeline cannot dispatch a task that names no repo at all.
    targetRepo: input.targetRepo || DEFAULT_TARGET_REPO,
    createdBy: input.createdBy ?? "ui",
    priority: input.priority ?? "normal",
  });
}

// ── Task retry (single source in shared) ────────────────────────────

export const retryTask = (taskId: string) =>
  retryPipelineTask(getPool(), taskId);
