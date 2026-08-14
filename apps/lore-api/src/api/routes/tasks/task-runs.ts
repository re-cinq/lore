import { errorMessage } from "@re-cinq/lore-shared";
import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";

export interface TaskRunRow {
  id: string;
  status: string;
  outcome: string | null;
  created_at: string;
}

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
    options: bearerScope("read"),
    handler: async (request, h) => {
      const pool = getPool();

      if (!pool) {
        return h.response({ error: DB_UNAVAILABLE }).code(503);
      }
      const taskId = request.params.id;

      try {
        const { rows } = await pool.query(
          `SELECT id FROM pipeline.tasks WHERE id = $1`,
          [taskId],
        );

        if (rows.length === 0) {
          return h.response({ error: "Task not found" }).code(404);
        }
      } catch (err) {
        return h.response({ error: errorMessage(err) }).code(500);
      }

      try {
        const { rows } = await pool.query<TaskRunRow>(
          `SELECT id, status, outcome, created_at
             FROM pipeline.assembly_lines
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
