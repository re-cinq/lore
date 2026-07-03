import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { createTask } from "@re-cinq/lore-server-core/features/pipeline/pipeline.js";
import { getTaskTypes } from "@re-cinq/lore-server-core/features/pipeline/pipeline-config.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { rawBody } from "../../../server/raw-body.js";

export function taskPostRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/task",
    options: { ...bearerScope("task"), payload: { parse: false } },
    handler: async (request, h) => {
      const pool = getPool();
      if (!pool) return h.response({ error: "database not available" }).code(503);
      try {
        const parsed = JSON.parse(rawBody(request));

        // Retry action
        if (parsed.action === "retry" && parsed.task_id) {
          const { retryTask } = await import("@re-cinq/lore-server-core/features/pipeline/pipeline.js");
          return h.response(await retryTask(parsed.task_id));
        }

        // Cancel action
        if (parsed.action === "cancel" && parsed.task_id) {
          await pool.query(
            `UPDATE pipeline.tasks SET status = 'cancelled', updated_at = now() WHERE id = $1 AND status NOT IN ('completed', 'failed', 'cancelled', 'merged')`,
            [parsed.task_id],
          );
          return h.response({ ok: true, task_id: parsed.task_id });
        }

        // Set priority action
        if (parsed.action === "set-priority" && parsed.task_id && parsed.priority) {
          const resolvedPriority = parsed.priority === "immediate" ? "immediate" : "normal";
          await pool.query(
            `UPDATE pipeline.tasks SET priority = $1, updated_at = now() WHERE id = $2 AND status = 'pending'`,
            [resolvedPriority, parsed.task_id],
          );
          return h.response({ ok: true, task_id: parsed.task_id, priority: resolvedPriority });
        }

        // Status update from local runner (no action field, has task_id + status)
        if (!parsed.action && parsed.task_id && parsed.status) {
          const allowedStatuses = ["running", "pr-created", "completed", "failed", "needs-human-help", "cancelled"];
          if (!allowedStatuses.includes(parsed.status)) return h.response({ error: `invalid status: ${parsed.status}` }).code(400);
          const setClauses = ["status = $1", "updated_at = now()"];
          const values: unknown[] = [parsed.status];
          if (parsed.pr_url) { setClauses.push(`pr_url = $${values.length + 1}`); values.push(parsed.pr_url); }
          if (parsed.error) { setClauses.push(`error = $${values.length + 1}`); values.push(parsed.error); }
          values.push(parsed.task_id);
          await pool.query(`UPDATE pipeline.tasks SET ${setClauses.join(", ")} WHERE id = $${values.length}`, values);
          return h.response({ ok: true, task_id: parsed.task_id, status: parsed.status });
        }

        // Create action (default)
        const { description, task_type, target_repo, priority, group_id, context } = parsed;
        if (!description?.trim()) return h.response({ error: "description is required" }).code(400);
        const validTypes = getTaskTypes();
        const resolvedType = validTypes.includes(task_type || "") ? task_type : "general";
        const result = await createTask(description, resolvedType, target_repo, "remote-mcp", context || undefined, priority || "normal", group_id || undefined);
        return h.response(result);
      } catch (err: any) {
        console.error("[api/task] error:", err.message);
        return h.response({ error: err.message }).code(500);
      }
    },
  };
}
