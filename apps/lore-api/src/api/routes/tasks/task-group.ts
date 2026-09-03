import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "../../../server/api-error.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { errorMessage } from "@re-cinq/lore-shared";
import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";

// One multi-repo feature's task rollup; an unknown group answers empty, not 404 — `task_group_id` is free-form, so "no rows" ≡ "never used".

const TERMINAL_SUCCESS = ["merged", "completed"];

const GroupParams = z.object({ id: z.string().min(1).max(200) });

type GroupParams = z.infer<typeof GroupParams>;

/** A multi-repo feature's tasks and how far they have got. */
const TaskGroupSchema = z.object({
  group_id: z.string(),
  total: z.number(),
  completed: z.number(),
  tasks: z.array(z.record(z.unknown())),
});

export function taskGroupRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/task-groups/{id}",
    options: zodResponse(
      {
        ...bearerScope("read"),
        validate: { params: zodValidate(GroupParams) },
      },
      TaskGroupSchema,
      {
        name: "TaskGroup",
        description: "Every task in a group, with completion",
      },
    ),
    handler: async (request, h) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);

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
