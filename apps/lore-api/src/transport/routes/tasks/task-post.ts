import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { zodResponse } from "../../http/zod-response.js";
import { rethrowBoom, apiError } from "@re-cinq/lore-shared/http/api-error.js";
import {
  errorMessage,
  cancelPipelineTask,
  escalatePipelineTask,
} from "@re-cinq/lore-shared";
import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { z } from "zod";
import { NO_TYPED_TASKS } from "@re-cinq/lore-shared/task-types/retired-task-types.js";
import { PgAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-pg.js";
import { cancelTaskAndItsRuns } from "../../../work/pipeline/cancel-task.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodValidate } from "../../http/zod-validate.js";
import { withPool } from "../with-pool.js";

// POST /api/task multiplexes its shapes with irregular dispatch (status-update has no `action`, a body naming no task is refused), so a discriminated union would contort (ADR-034 FR6) — branch selection stays in the handler.
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
  task_type: z.string().optional(),
  target_repo: z.string().optional(),
  group_id: z.string().optional(),
  context: z.unknown().optional(),
});

type TaskBody = z.infer<typeof TaskBody>;

// One POST multiplexes cancel/retry/run-now/revise/set-priority; the contract is the union of what those answer.
const TaskWriteSchema = z.record(z.string(), z.unknown());

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
        description: "The transition's acknowledgement",
        errors: [400, 404, 409],
      },
    ),
    handler: withPool(getPool, serveTaskPost),
  };
}

/** Acknowledging a transition on a task; the action rides in the body. */
async function serveTaskPost(
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  try {
    const parsed = request.payload as TaskBody;

    return (await actOnExistingTask(pool, h, parsed)) ?? refuseTypedTask();
  } catch (err) {
    // A guard's refusal already carries its status; only an unexpected failure is this block's to shape.
    rethrowBoom(err);

    console.error("[api/task] error:", errorMessage(err));

    return h.response({ error: errorMessage(err) }).code(500);
  }
}

/** Every shape that names an existing task; null when the body names none. */
async function actOnExistingTask(
  pool: Pool,
  h: ResponseToolkit,
  parsed: TaskBody,
): Promise<ResponseObject | null> {
  const taskId = parsed.task_id;

  if (!taskId) {
    return null;
  }

  const knownAction = parsed.action
    ? EXISTING_TASK_ACTIONS[parsed.action]
    : undefined;

  if (knownAction) {
    return knownAction(pool, h, parsed, taskId);
  }

  return (
    (await setPriority(pool, h, parsed, taskId)) ??
    (await reportRunnerStatus(pool, h, parsed, taskId))
  );
}

const REVISED_ON_THE_PR =
  "A task is no longer revised from here. Leave the feedback as a review that requests changes on its pull request: Lore answers it there.";

// Refuse rather than silently no-op on unknown id, terminal state, or past pending.
const EXISTING_TASK_ACTIONS: Record<
  string,
  (
    pool: Pool,
    h: ResponseToolkit,
    parsed: TaskBody,
    taskId: string,
  ) => Promise<ResponseObject>
> = {
  retry: (_pool, h, _parsed, taskId) => retryAction(h, taskId),
  cancel: (pool, h, _parsed, taskId) =>
    refusable(h, () =>
      cancelTaskAndItsRuns(taskId, {
        cancelTask: (id) => cancelPipelineTask(pool, id),
        runs: new PgAssemblyRuns(pool),
      }),
    ),
  "run-now": (pool, h, _parsed, taskId) =>
    refusable(h, () => escalatePipelineTask(pool, taskId)),
  revise: reviseAction,
};

async function retryAction(
  h: ResponseToolkit,
  taskId: string,
): Promise<ResponseObject> {
  const { retryTask } =
    await import("@re-cinq/lore-server-core/features/pipeline/pipeline.js");

  return refusable(h, () => retryTask(taskId));
}

/** A task used to be revised by queueing a follow-up task from a person's feedback. The task type that ran it is gone, and a pull request is revised where it is reviewed. */
function reviseAction(
  _pool: Pool,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  return Promise.resolve(h.response({ error: REVISED_ON_THE_PR }).code(409));
}

// Refusable state transition (retry, cancel, run-now): the shared seams throw "Task not found" (404) or a state message (409) — one mapping so the branches can't drift. A retry is refused when the task is not failed, and when its type was removed.
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
  const priority = parsed.priority === "immediate" ? "immediate" : "normal";

  await pool.query(
    `UPDATE pipeline.tasks SET priority = $1, updated_at = now() WHERE id = $2 AND status = 'pending'`,
    [priority, taskId],
  );

  return h.response({ ok: true, task_id: taskId, priority });
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
  update: RunnerStatusUpdate,
) {
  const { status } = update;

  enforceTrue(
    ALLOWED_STATUSES.includes(status),
    apiError(400),
    `invalid status: ${status}`,
  );
  const { clauses, values } = statusSetClauses(update);

  values.push(taskId);
  await pool.query(
    `UPDATE pipeline.tasks SET ${clauses.join(", ")} WHERE id = $${values.length}`,
    values,
  );

  return { ok: true, task_id: taskId, status };
}

/** The SET list and its bind values built together, because each optional column's placeholder number is decided by how many values precede it. */
function statusSetClauses({ status, prUrl, error }: RunnerStatusUpdate): {
  clauses: string[];
  values: unknown[];
} {
  const clauses = ["status = $1", "updated_at = now()"];
  const values: unknown[] = [status];

  if (prUrl) {
    clauses.push(`pr_url = $${values.length + 1}`);
    values.push(prUrl);
  }

  if (error) {
    clauses.push(`error = $${values.length + 1}`);
    values.push(error);
  }

  return { clauses, values };
}

/** A body with no task id used to create a task. None is created from a description any more, so the caller is told where that work goes instead. */
function refuseTypedTask(): never {
  throw apiError(400)(NO_TYPED_TASKS);
}
