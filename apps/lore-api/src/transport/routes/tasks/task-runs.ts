import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { errorMessage } from "@re-cinq/lore-shared";
import { rethrowBoom, apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { selectList, pickColumns } from "@re-cinq/lore-shared/lib/row.js";
import { wireSchema } from "@re-cinq/lore-shared/lib/wire-schema.js";
import {
  AssemblyRunSchema,
  ASSEMBLY_RUN_COLUMNS,
} from "@re-cinq/lore-shared/models/assembly-run.js";
import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { z } from "zod";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";

/** What the page needs of a run: enough to label it and attach a stream. */
const TASK_RUN_COLUMNS = pickColumns(ASSEMBLY_RUN_COLUMNS, [
  "id",
  "status",
  "outcome",
  "createdAt",
]);

const TaskRunSchema = wireSchema(
  AssemblyRunSchema.pick({
    id: true,
    status: true,
    outcome: true,
    createdAt: true,
  }),
  ASSEMBLY_RUN_COLUMNS,
);

const TaskRunListSchema = z.object({ runs: z.array(TaskRunSchema) });

export type TaskRunRow = z.infer<typeof TaskRunSchema>;

/** Postgres "relation does not exist" — a pre-0025 database has no assembly_lines table; a task there simply has no runs. */
const UNDEFINED_TABLE = "42P01";

// The 404 comes first deliberately: an unknown task and a task with no runs both used to answer `{runs: []}`, misreading a never-existed id as "nothing started yet".
/** Every attempt at one task. A task can be re-dispatched, so the run list — not the task row — is the execution history. */
/** Refuses an unknown task with a 404 rather than an empty run list — "no runs" and "no such task" are different answers, and only the first invites the caller to wait. Returns a response when the check itself failed, so the caller can distinguish that from the task being absent. */
async function enforceTaskExists(
  pool: Pool,
  taskId: string,
  h: ResponseToolkit,
): Promise<ResponseObject | null> {
  try {
    const { rows } = await pool.query(
      `SELECT id FROM pipeline.tasks WHERE id = $1`,
      [taskId],
    );

    enforceTrue(rows.length !== 0, apiError(404), "Task not found");

    return null;
  } catch (err) {
    // A guard's refusal already carries its status; only an unexpected failure is this block's to shape.
    rethrowBoom(err);

    return h.response({ error: errorMessage(err) }).code(500);
  }
}

async function serveTaskRuns(
  getPool: () => Pool | null,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const pool = getPool();

  enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
  const taskId = request.params.id;

  const missing = await enforceTaskExists(pool, taskId, h);

  return missing ?? (await respondWithRuns(pool, taskId, h));
}

/** A pipeline.assembly_runs that does not exist yet reads as no runs, not as a failure — the table arrives with a migration. */
async function respondWithRuns(
  pool: Pool,
  taskId: string,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  try {
    return h.response({ runs: await readTaskRuns(pool, taskId) });
  } catch (err) {
    if ((err as { code?: string }).code === UNDEFINED_TABLE) {
      return h.response({ runs: [] });
    }

    return h.response({ error: errorMessage(err) }).code(500);
  }
}

async function readTaskRuns(pool: Pool, taskId: string): Promise<TaskRunRow[]> {
  const { rows } = await pool.query<TaskRunRow>(
    `SELECT ${selectList(TASK_RUN_COLUMNS)}
         FROM pipeline.assembly_runs
        WHERE task_id = $1
        ORDER BY created_at DESC`,
    [taskId],
  );

  return rows;
}

export function taskRunsRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/tasks/{id}/runs",
    options: zodResponse(bearerScope("read"), TaskRunListSchema, {
      name: "TaskRunList",
      description: "The task's per-attempt runs, newest first",
      errors: [404],
    }),
    handler: (request, h) => serveTaskRuns(getPool, request, h),
  };
}
