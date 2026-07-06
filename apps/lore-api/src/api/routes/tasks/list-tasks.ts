import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { listTasks } from "@re-cinq/lore-server-core/features/pipeline/pipeline.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";

// pipeline.tasks.status is free-form TEXT (no DB enum, open vocabulary), so this
// bounds the shape rather than fixing a value set. limit preserves the historical
// clamp-to-100 (not reject) so an over-max request degrades, matching prior behavior.
const ListTasksQuery = z.object({
  status: z.string().regex(/^[a-z-]+$/).max(40).optional(),
  limit: z.coerce.number().int().positive().transform(n => Math.min(n, 100)).default(20),
});
type ListTasksQuery = z.infer<typeof ListTasksQuery>;

export function listTasksRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/tasks",
    options: { ...bearerScope("read"), validate: { query: zodValidate(ListTasksQuery) } },
    handler: async (request, h) => {
      const { status, limit } = request.query as unknown as ListTasksQuery;
      try {
        return h.response(await listTasks(status, limit));
      } catch (err: any) {
        return h.response({ error: err.message }).code(500);
      }
    },
  };
}
