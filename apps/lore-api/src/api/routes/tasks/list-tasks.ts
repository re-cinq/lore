import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { listTasks } from "@re-cinq/lore-server-core/features/pipeline/pipeline.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { clampedLimit, offsetParam } from "../common-schemas.js";

// pipeline.tasks.status is free-form TEXT (no DB enum, open vocabulary), so this
// bounds the shape rather than fixing a value set.
const ListTasksQuery = z.object({
  status: z.string().regex(/^[a-z-]+$/).max(40).optional(),
  limit: clampedLimit.default(20),
  offset: offsetParam,
});
type ListTasksQuery = z.infer<typeof ListTasksQuery>;

export function listTasksRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/tasks",
    options: { ...bearerScope("read"), validate: { query: zodValidate(ListTasksQuery) } },
    handler: async (request, h) => {
      const { status, limit, offset } = request.query as unknown as ListTasksQuery;
      try {
        const result = await listTasks(status, limit, offset);
        return h.response({ ...result, limit, offset });
      } catch (err: any) {
        return h.response({ error: err.message }).code(500);
      }
    },
  };
}
