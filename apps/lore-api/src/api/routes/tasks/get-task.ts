import type { ServerRoute } from "@hapi/hapi";
import { getTask } from "@re-cinq/lore-server-core/features/pipeline/pipeline.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";

export function getTaskRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/task/{id}",
    options: bearerScope("read"),
    handler: async (request, h) => {
      try {
        const task = await getTask(request.params.id);

        if (!task) {
          return h.response({ error: "not found" }).code(404);
        }

        return h.response(task);
      } catch (err: any) {
        return h.response({ error: err.message }).code(500);
      }
    },
  };
}
