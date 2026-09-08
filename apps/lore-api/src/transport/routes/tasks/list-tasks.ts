import { zodResponse } from "../../http/zod-response.js";
import { errorMessage } from "@re-cinq/lore-shared";
import type Hapi from "@hapi/hapi";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { listTasks } from "@re-cinq/lore-server-core/features/pipeline/pipeline.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodValidate } from "../../http/zod-validate.js";
import { clampedLimit, offsetParam } from "../common-schemas.js";

// pipeline.tasks.status is free-form TEXT (no DB enum), so this bounds the shape rather than fixing a value set.
const ListTasksQuery = z.object({
  status: z
    .string()
    .regex(/^[a-z-]+$/)
    .max(40)
    .optional(),
  limit: clampedLimit.default(20),
  offset: offsetParam,
});

type ListTasksQuery = z.infer<typeof ListTasksQuery>;

/** A page of tasks plus the paging the caller asked for. */
const TaskPageSchema = z.object({
  tasks: z.array(z.record(z.string(), z.unknown())),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export function listTasksRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/tasks",
    options: zodResponse(
      {
        ...bearerScope("read"),
        validate: { query: zodValidate(ListTasksQuery) },
      },
      TaskPageSchema,
      { name: "TaskPage", description: "A page of pipeline tasks" },
    ),
    handler: serveListTasks,
  };
}

async function serveListTasks(
  request: Hapi.Request,
  h: Hapi.ResponseToolkit,
): Promise<Hapi.ResponseObject> {
  const { status, limit, offset } = request.query as unknown as ListTasksQuery;

  try {
    const result = await listTasks(status, limit, offset);

    return h.response({ ...result, limit, offset });
  } catch (err) {
    return h.response({ error: errorMessage(err) }).code(500);
  }
}
