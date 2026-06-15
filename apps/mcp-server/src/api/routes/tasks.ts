import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { createTask, getTask, listTasks } from "../../features/pipeline/pipeline.js";
import { getTaskTypes } from "../../features/pipeline/pipeline-config.js";
import { json, readBody } from "./http.js";

export async function handleGetTask(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const taskId = req.url!.replace("/api/task/", "");
  try {
    const task = await getTask(taskId);
    if (!task) { json(res, 404, { error: "not found" }); return; }
    json(res, 200, task);
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}

export async function handleListTasks(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url!, `http://localhost`);
  const status = url.searchParams.get("status") || undefined;
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 100);
  try {
    const result = await listTasks(status, limit);
    json(res, 200, result);
  } catch (err: any) {
    json(res, 500, { error: err.message });
  }
}

export async function handleTaskPost(req: IncomingMessage, res: ServerResponse, pool: Pool | null): Promise<void> {
  if (!pool) { json(res, 503, { error: "database not available" }); return; }
  const body = await readBody(req);
  try {
    const parsed = JSON.parse(body);

    // Retry action
    if (parsed.action === "retry" && parsed.task_id) {
      const { retryTask } = await import('../../features/pipeline/pipeline.js');
      const retryResult = await retryTask(parsed.task_id);
      json(res, 200, retryResult);
      return;
    }

    // Cancel action
    if (parsed.action === "cancel" && parsed.task_id) {
      await pool.query(
        `UPDATE pipeline.tasks SET status = 'cancelled', updated_at = now() WHERE id = $1 AND status NOT IN ('completed', 'failed', 'cancelled', 'merged')`,
        [parsed.task_id],
      );
      json(res, 200, { ok: true, task_id: parsed.task_id });
      return;
    }

    // Set priority action
    if (parsed.action === "set-priority" && parsed.task_id && parsed.priority) {
      const resolvedPriority = parsed.priority === "immediate" ? "immediate" : "normal";
      await pool.query(
        `UPDATE pipeline.tasks SET priority = $1, updated_at = now() WHERE id = $2 AND status = 'pending'`,
        [resolvedPriority, parsed.task_id],
      );
      json(res, 200, { ok: true, task_id: parsed.task_id, priority: resolvedPriority });
      return;
    }

    // Status update from local runner (no action field, has task_id + status)
    if (!parsed.action && parsed.task_id && parsed.status) {
      const allowedStatuses = ["running", "pr-created", "completed", "failed", "needs-human-help", "cancelled"];
      if (!allowedStatuses.includes(parsed.status)) {
        json(res, 400, { error: `invalid status: ${parsed.status}` });
        return;
      }
      const setClauses = ["status = $1", "updated_at = now()"];
      const values: unknown[] = [parsed.status];
      if (parsed.pr_url) { setClauses.push(`pr_url = $${values.length + 1}`); values.push(parsed.pr_url); }
      if (parsed.error) { setClauses.push(`error = $${values.length + 1}`); values.push(parsed.error); }
      values.push(parsed.task_id);
      await pool.query(
        `UPDATE pipeline.tasks SET ${setClauses.join(", ")} WHERE id = $${values.length}`,
        values,
      );
      json(res, 200, { ok: true, task_id: parsed.task_id, status: parsed.status });
      return;
    }

    // Create action (default)
    const { description, task_type, target_repo, priority, context } = parsed;
    if (!description?.trim()) {
      json(res, 400, { error: "description is required" });
      return;
    }
    const validTypes = getTaskTypes();
    const resolvedType = validTypes.includes(task_type || "") ? task_type : "general";
    const result = await createTask(description, resolvedType, target_repo, "remote-mcp", context || undefined, priority || "normal");
    json(res, 200, result);
  } catch (err: any) {
    console.error("[api/task] error:", err.message);
    json(res, 500, { error: err.message });
  }
}
