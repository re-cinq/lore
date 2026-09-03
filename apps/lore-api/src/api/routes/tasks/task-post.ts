import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { rethrowBoom, apiError } from "../../../server/api-error.js";
import {
  errorMessage,
  cancelPipelineTask,
  escalatePipelineTask,
  revisePipelineTask,
} from "@re-cinq/lore-shared";
import type { Pool } from "pg";
import type { ServerRoute, ResponseToolkit, ResponseObject } from "@hapi/hapi";
import { z } from "zod";
import { createTask } from "@re-cinq/lore-server-core/features/pipeline/pipeline.js";
import { getTaskTypes } from "@re-cinq/lore-server-core/features/pipeline/pipeline-config.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";

// POST /api/task multiplexes 5 shapes with irregular dispatch (status-update has no `action`, create is the fallback), so a discriminated union would contort (ADR-034 FR6) — branch selection stays in the handler.
const TaskBody = z.object({
  action: z.string().optional(),
  task_id: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  pr_url: z.string().optional(),
  error: z.string().optional(),
  description: z.string().optional(),
  /** Who queued it; an unnamed caller is the remote MCP adapter (the historical default). */
  created_by: z.string().optional(),
  /** The human's words, carried into the revision task's context bundle. */
  feedback: z.string().optional(),
  task_type: z.string().optional(),
  target_repo: z.string().optional(),
  group_id: z.string().optional(),
  context: z.unknown().optional(),
});

type TaskBody = z.infer<typeof TaskBody>;

// Refusable state transition (cancel, run-now): both shared seams throw "Task not found" (404) or a state message (409) — one mapping so the branches can't drift.
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

const ALLOWED_STATUSES = [
  "running",
  "pr-created",
  "completed",
  "failed",
  "needs-human-help",
  "cancelled",
];

/** Status update from the local runner (no action field, has task_id + status). */
interface RunnerStatusUpdate {
  status: string;
  prUrl: string | undefined;
  error: string | undefined;
}

async function updateTaskStatus(
  pool: Pool,
  taskId: string,
  { status, prUrl, error }: RunnerStatusUpdate,
) {
  enforceTrue(
    ALLOWED_STATUSES.includes(status),
    apiError(400),
    `invalid status: ${status}`,
  );
  const setClauses = ["status = $1", "updated_at = now()"];
  const values: unknown[] = [status];

  if (prUrl) {
    setClauses.push(`pr_url = $${values.length + 1}`);
    values.push(prUrl);
  }

  if (error) {
    setClauses.push(`error = $${values.length + 1}`);
    values.push(error);
  }
  values.push(taskId);
  await pool.query(
    `UPDATE pipeline.tasks SET ${setClauses.join(", ")} WHERE id = $${values.length}`,
    values,
  );

  return { ok: true, task_id: taskId, status };
}

// One POST multiplexes create/cancel/retry/run-now/revise/set-priority; the contract is the union of what those answer.
const TaskWriteSchema = z.record(z.unknown());

/** Every shape that names an EXISTING task; null when the body names none, which means "create". */
async function actOnExistingTask(
  pool: Pool,
  h: ResponseToolkit,
  parsed: TaskBody,
): Promise<ResponseObject | null> {
  const taskId = parsed.task_id;

  if (!taskId) {
    return null;
  }

  if (parsed.action === "retry") {
    const { retryTask } =
      await import("@re-cinq/lore-server-core/features/pipeline/pipeline.js");

    return h.response(await retryTask(taskId));
  }

  // Each of these refuses rather than silently no-op'ing: cancel on an unknown
  // id or a terminal state, run-now on a task past `pending`, revise by parking
  // the parent so it never points at an unexplained follow-up.
  if (parsed.action === "cancel") {
    return refusable(h, () => cancelPipelineTask(pool, taskId));
  }

  if (parsed.action === "run-now") {
    return refusable(h, () => escalatePipelineTask(pool, taskId));
  }

  if (parsed.action === "revise") {
    const feedback = parsed.feedback ?? "";

    return refusable(h, () => revisePipelineTask(pool, taskId, feedback));
  }

  return (
    (await setPriority(pool, h, parsed, taskId)) ??
    (await reportRunnerStatus(pool, h, parsed, taskId))
  );
}

/** Plain priority write — unlike run-now it records no transition, so a task past `pending` is simply not matched. */
async function setPriority(
  pool: Pool,
  h: ResponseToolkit,
  parsed: TaskBody,
  taskId: string,
): Promise<ResponseObject | null> {
  if (parsed.action !== "set-priority" || !parsed.priority) {
    return null;
  }
  const resolvedPriority =
    parsed.priority === "immediate" ? "immediate" : "normal";

  await pool.query(
    `UPDATE pipeline.tasks SET priority = $1, updated_at = now() WHERE id = $2 AND status = 'pending'`,
    [resolvedPriority, taskId],
  );

  return h.response({
    ok: true,
    task_id: taskId,
    priority: resolvedPriority,
  });
}

/** The local runner reporting progress: no action field, a task id and a status. */
async function reportRunnerStatus(
  pool: Pool,
  h: ResponseToolkit,
  parsed: TaskBody,
  taskId: string,
): Promise<ResponseObject | null> {
  if (parsed.action || !parsed.status) {
    return null;
  }

  return h.response(
    await updateTaskStatus(pool, taskId, {
      status: parsed.status,
      prUrl: parsed.pr_url,
      error: parsed.error,
    }),
  );
}

/** The default: a body with no task id creates one. */
async function createTaskFromBody(
  h: ResponseToolkit,
  parsed: TaskBody,
): Promise<ResponseObject> {
  const { description, task_type, target_repo } = parsed;

  // `typeof` first so the assertion narrows `description` itself — an optional-chained CALL isn't a reference TS can narrow on.
  enforceTrue(
    typeof description === "string" && description.trim() !== "",
    apiError(400),
    "description is required",
  );
  // Onboarding's duplicate-guard lives in the /api/onboard transaction (dupes race their own Issue+PR — #968); refuse here rather than route around it.
  enforceTrue(
    task_type !== "onboard",
    apiError(400),
    "onboard tasks are created via POST /api/onboard, which guards against duplicates",
  );

  return h.response(
    await createTask({
      description,
      taskType: getTaskTypes().includes(task_type || "")
        ? task_type
        : "general",
      targetRepo: target_repo,
      createdBy: parsed.created_by || "remote-mcp",
      contextBundle: (parsed.context as Record<string, unknown>) || undefined,
      priority: parsed.priority || "normal",
      taskGroupId: parsed.group_id || undefined,
    }),
  );
}

export function taskPostRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "POST",
    path: "/api/task",
    options: zodResponse(
      {
        ...bearerScope("task"),
        validate: { payload: zodValidate(TaskBody) },
      },
      TaskWriteSchema,
      {
        name: "TaskWriteResult",
        description: "The created task, or the transition's acknowledgement",
        errors: [400, 404, 409],
      },
    ),
    handler: async (request, h) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);

      try {
        const parsed = request.payload as TaskBody;

        return (
          (await actOnExistingTask(pool, h, parsed)) ??
          (await createTaskFromBody(h, parsed))
        );
      } catch (err) {
        // A guard's refusal already carries its status; only an unexpected failure is this block's to shape.
        rethrowBoom(err);

        console.error("[api/task] error:", errorMessage(err));

        return h.response({ error: errorMessage(err) }).code(500);
      }
    },
  };
}
