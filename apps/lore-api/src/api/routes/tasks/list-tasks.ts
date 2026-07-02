import type { ServerRoute } from "@hapi/hapi";
import { listTasks } from "@re-cinq/lore-server-core/features/pipeline/pipeline.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";

export function listTasksRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/tasks",
    options: bearerScope("read"),
    handler: async (request, h) => {
      const q = request.query as Record<string, string | undefined>;
      const status = q.status || undefined;
      const limit = Math.min(parseInt(q.limit || "20"), 100);
      try {
        return h.response(await listTasks(status, limit));
      } catch (err: any) {
        return h.response({ error: err.message }).code(500);
      }
    },
  };
}
