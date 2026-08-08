import { errorMessage } from "@re-cinq/lore-shared";
import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";

/**
 * One multi-repo feature's task rollup, for `lore_list_task_group`. An unknown
 * group is an empty group, not a 404: `task_group_id` is a free-form correlation
 * key, so "no rows" is indistinguishable from "never used".
 */

const TERMINAL_SUCCESS = ["merged", "completed"];

const GroupParams = z.object({ id: z.string().min(1).max(200) });

type GroupParams = z.infer<typeof GroupParams>;

export function taskGroupRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/task-groups/{id}",
    options: {
      ...bearerScope("read"),
      validate: { params: zodValidate(GroupParams) },
    },
    handler: async (request, h) => {
      const pool = getPool();

      if (!pool) {
        return h.response({ error: DB_UNAVAILABLE }).code(503);
      }

      const { id } = request.params as unknown as GroupParams;

      try {
        const { rows } = await pool.query<{ status: string }>(
          `SELECT id, description, task_type, status, target_repo, pr_url, created_at
           FROM pipeline.tasks WHERE task_group_id = $1 ORDER BY created_at`,
          [id],
        );

        return h.response({
          group_id: id,
          total: rows.length,
          completed: rows.filter((t) => TERMINAL_SUCCESS.includes(t.status))
            .length,
          tasks: rows,
        });
      } catch (err) {
        return h.response({ error: errorMessage(err) }).code(500);
      }
    },
  };
}
