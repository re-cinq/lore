import {
  errorMessage,
  cancelPipelineTask,
  escalatePipelineTask,
} from "@re-cinq/lore-shared";
import type { Pool } from "pg";
import type { ServerRoute, ResponseToolkit } from "@hapi/hapi";
import { z } from "zod";
import { createTask } from "@re-cinq/lore-server-core/features/pipeline/pipeline.js";
import { getTaskTypes } from "@re-cinq/lore-server-core/features/pipeline/pipeline-config.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";

// POST /api/task multiplexes five shapes (retry / cancel / set-priority /
// status-update / create) with irregular dispatch — status-update has no
// `action`, create is the fallback — so a discriminated union would contort
// (ADR-034 FR6). The schema guards the object shape; the branch selection and
// its conditional 400s (blank description, invalid status) stay in the handler.
const TaskBody = z.object({
  action: z.string().optional(),
  task_id: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  pr_url: z.string().optional(),
  error: z.string().optional(),
  description: z.string().optional(),
  task_type: z.string().optional(),
  target_repo: z.string().optional(),
  group_id: z.string().optional(),
  context: z.unknown().optional(),
});

type TaskBody = z.infer<typeof TaskBody>;

/**
 * Run a refusable state transition (cancel, run-now). Both shared seams throw
 * "Task not found" for an unknown id and a state message otherwise, which are a
 * 404 and a 409 — one mapping, so the two branches cannot drift apart.
 */
async function refusable<T extends object>(
  h: ResponseToolkit,
  transition: () => Promise<T>,
) {
  try {
    return h.response(await transition());
  } catch (err) {
    const message = errorMessage(err);

    return h
      .response({ error: message })
      .code(message === "Task not found" ? 404 : 409);
  }
}

export function taskPostRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/task",
    options: {
      ...bearerScope("task"),
      validate: { payload: zodValidate(TaskBody) },
    },
    handler: async (request, h) => {
      const pool = getPool();

      if (!pool) {
        return h.response({ error: DB_UNAVAILABLE }).code(503);
      }

      try {
        const parsed = request.payload as TaskBody;

        // Retry action
        if (parsed.action === "retry" && parsed.task_id) {
          const { retryTask } =
            await import("@re-cinq/lore-server-core/features/pipeline/pipeline.js");

          return h.response(await retryTask(parsed.task_id));
        }

        // Cancel action — the shared canceller, so an unknown id or a terminal
        // state is refused instead of silently no-op'ing, and the transition
        // lands in pipeline.task_events like every other status change.
        if (parsed.action === "cancel" && parsed.task_id) {
          const taskId = parsed.task_id;

          return refusable(h, () => cancelPipelineTask(pool, taskId));
        }

        // Run-now action — the escalation the task page's button performs.
        // Refuses a task past `pending` rather than no-op'ing, and records the
        // transition, which the bare `set-priority` action below does not.
        if (parsed.action === "run-now" && parsed.task_id) {
          const taskId = parsed.task_id;

          return refusable(h, () => escalatePipelineTask(pool, taskId));
        }

        // Set priority action
        if (
          parsed.action === "set-priority" &&
          parsed.task_id &&
          parsed.priority
        ) {
          const resolvedPriority =
            parsed.priority === "immediate" ? "immediate" : "normal";

          await pool.query(
            `UPDATE pipeline.tasks SET priority = $1, updated_at = now() WHERE id = $2 AND status = 'pending'`,
            [resolvedPriority, parsed.task_id],
          );

          return h.response({
            ok: true,
            task_id: parsed.task_id,
            priority: resolvedPriority,
          });
        }

        // Status update from local runner (no action field, has task_id + status)
        if (!parsed.action && parsed.task_id && parsed.status) {
          const allowedStatuses = [
            "running",
            "pr-created",
            "completed",
            "failed",
            "needs-human-help",
            "cancelled",
          ];

          if (!allowedStatuses.includes(parsed.status)) {
            return h
              .response({ error: `invalid status: ${parsed.status}` })
              .code(400);
          }
          const setClauses = ["status = $1", "updated_at = now()"];
          const values: unknown[] = [parsed.status];

          if (parsed.pr_url) {
            setClauses.push(`pr_url = $${values.length + 1}`);
            values.push(parsed.pr_url);
          }

          if (parsed.error) {
            setClauses.push(`error = $${values.length + 1}`);
            values.push(parsed.error);
          }
          values.push(parsed.task_id);
          await pool.query(
            `UPDATE pipeline.tasks SET ${setClauses.join(", ")} WHERE id = $${values.length}`,
            values,
          );

          return h.response({
            ok: true,
            task_id: parsed.task_id,
            status: parsed.status,
          });
        }

        // Create action (default)
        const {
          description,
          task_type,
          target_repo,
          priority,
          group_id,
          context,
        } = parsed;

        if (!description?.trim()) {
          return h.response({ error: "description is required" }).code(400);
        }

        // Onboarding is guarded (duplicate onboard tasks each file their own
        // Issue and race their own PR — #968), and the guard lives in the
        // /api/onboard transaction. Refuse here rather than route around it.
        if (task_type === "onboard") {
          return h
            .response({
              error:
                "onboard tasks are created via POST /api/onboard, which guards against duplicates",
            })
            .code(400);
        }
        const validTypes = getTaskTypes();
        const resolvedType = validTypes.includes(task_type || "")
          ? task_type
          : "general";
        const result = await createTask(
          description,
          resolvedType,
          target_repo,
          "remote-mcp",
          (context as Record<string, unknown>) || undefined,
          priority || "normal",
          group_id || undefined,
        );

        return h.response(result);
      } catch (err) {
        console.error("[api/task] error:", errorMessage(err));

        return h.response({ error: errorMessage(err) }).code(500);
      }
    },
  };
}
