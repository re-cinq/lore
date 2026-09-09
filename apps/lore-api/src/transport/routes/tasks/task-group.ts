import { zodResponse } from "../../http/zod-response.js";
import { errorMessage } from "@re-cinq/lore-shared";
import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { z } from "zod";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodValidate } from "../../http/zod-validate.js";
import { withPool } from "../with-pool.js";

// One multi-repo feature's task rollup; an unknown group answers empty, not 404 — `task_group_id` is free-form, so "no rows" ≡ "never used".

const TERMINAL_SUCCESS = ["merged", "completed"];

const GroupParams = z.object({ id: z.string().min(1).max(200) });

type GroupParams = z.infer<typeof GroupParams>;

/** A multi-repo feature's tasks and how far they have got. */
const TaskGroupSchema = z.object({
  group_id: z.string(),
  total: z.number(),
  completed: z.number(),
  tasks: z.array(z.record(z.string(), z.unknown())),
});

/** Every task in one feature's group, with completion state — the view that answers whether a multi-repo feature is done. */
async function serveTaskGroup(
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const { id } = request.params as unknown as GroupParams;

  try {
    return h.response(await readTaskGroup(pool, id));
  } catch (err) {
    return h.response({ error: errorMessage(err) }).code(500);
  }
}

const GROUP_TASKS_SQL = `SELECT id, description, task_type, status, target_repo, pr_url, created_at
       FROM pipeline.tasks WHERE task_group_id = $1 ORDER BY created_at`;

async function readTaskGroup(pool: Pool, id: string) {
  const { rows } = await pool.query<{ status: string }>(GROUP_TASKS_SQL, [id]);

  return {
    group_id: id,
    total: rows.length,
    completed: rows.filter((t) => TERMINAL_SUCCESS.includes(t.status)).length,
    tasks: rows,
  };
}

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
    handler: withPool(getPool, serveTaskGroup),
  };
}
