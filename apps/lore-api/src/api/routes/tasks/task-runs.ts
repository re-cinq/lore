import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { errorMessage } from "@re-cinq/lore-shared";
import { rethrowBoom, apiError } from "../../../server/api-error.js";
import { selectList, pickColumns } from "@re-cinq/lore-shared/lib/row.js";
import { wireSchema } from "@re-cinq/lore-shared/lib/wire-schema.js";
import {
  AssemblyRunSchema,
  ASSEMBLY_RUN_COLUMNS,
} from "@re-cinq/lore-shared/models/assembly-run.js";
import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
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

/** Postgres "relation does not exist" — a database that predates migration
 *  0025 has no assembly_lines table, and a task there simply has no runs. */
const UNDEFINED_TABLE = "42P01";

/**
 * `GET /api/tasks/{id}/runs` — the task's per-attempt assembly-line runs, newest
 * first. The task page's refresh coordinator polls this to discover a run that
 * starts after the page rendered, so it can attach the live event stream to it.
 *
 * The 404 comes first deliberately: an unknown task and a task with no runs both
 * used to answer `{runs: []}`, which reads as "nothing started yet" for an id
 * that never existed.
 */
export function taskRunsRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/tasks/{id}/runs",
    options: zodResponse(bearerScope("read"), TaskRunListSchema, {
      name: "TaskRunList",
      description: "The task's per-attempt runs, newest first",
      errors: [404],
    }),
    handler: async (request, h) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
      const taskId = request.params.id;

      try {
        const { rows } = await pool.query(
          `SELECT id FROM pipeline.tasks WHERE id = $1`,
          [taskId],
        );

        enforceTrue(rows.length !== 0, apiError(404), "Task not found");
      } catch (err) {
        // A guard's refusal already carries its status; only an unexpected failure
        // is this block's to shape.
        rethrowBoom(err);

        return h.response({ error: errorMessage(err) }).code(500);
      }

      try {
        const { rows } = await pool.query<TaskRunRow>(
          `SELECT ${selectList(TASK_RUN_COLUMNS)}
             FROM pipeline.assembly_runs
            WHERE task_id = $1
            ORDER BY created_at DESC`,
          [taskId],
        );

        return h.response({ runs: rows });
      } catch (err) {
        if ((err as { code?: string }).code === UNDEFINED_TABLE) {
          return h.response({ runs: [] });
        }

        return h.response({ error: errorMessage(err) }).code(500);
      }
    },
  };
}
