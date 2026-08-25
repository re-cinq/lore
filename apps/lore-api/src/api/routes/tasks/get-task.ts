import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { errorMessage } from "@re-cinq/lore-shared";
import { rethrowBoom, apiError } from "../../../server/api-error.js";
import { wireSchema } from "@re-cinq/lore-shared/lib/wire-schema.js";
import {
  PipelineTaskSchema,
  PIPELINE_TASK_COLUMNS,
} from "@re-cinq/lore-shared/models/pipeline-task.js";
import {
  TaskEventSchema,
  TASK_EVENT_COLUMNS,
} from "@re-cinq/lore-shared/models/task-event.js";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { getTask } from "@re-cinq/lore-server-core/features/pipeline/pipeline.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";

/**
 * The task row plus its transition trail, both derived from their models so the
 * body and the tables state the same fields. Keys are the COLUMN names: that is
 * what the deployed web-ui reads, and flipping it is expand/contract work.
 */
const TaskDetailSchema = wireSchema(
  PipelineTaskSchema,
  PIPELINE_TASK_COLUMNS,
).extend({
  events: z.array(wireSchema(TaskEventSchema, TASK_EVENT_COLUMNS)),
});

export function getTaskRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/task/{id}",
    options: zodResponse(bearerScope("read"), TaskDetailSchema, {
      name: "TaskDetail",
      description: "One task and the transitions it has recorded",
      errors: [404],
    }),
    handler: async (request, h) => {
      try {
        const task = await getTask(request.params.id);

        enforceTrue(task, apiError(404), "not found");

        return h.response(task);
      } catch (err) {
        // A guard's refusal already carries its status; only an unexpected failure
        // is this block's to shape.
        rethrowBoom(err);

        return h.response({ error: errorMessage(err) }).code(500);
      }
    },
  };
}
