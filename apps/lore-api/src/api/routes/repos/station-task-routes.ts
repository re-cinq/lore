import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { ServerRoute } from "@hapi/hapi";
import { rethrowBoom, apiError } from "../../../server/api-error.js";
import { z } from "zod";
import { projectFor } from "../../../platform/project-boot.js";
import { wireSchema } from "@re-cinq/lore-shared/lib/wire-schema.js";
import {
  PipelineTaskSchema,
  PIPELINE_TASK_COLUMNS,
} from "@re-cinq/lore-shared/models/pipeline-task.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { repoOf, fail } from "./station-helpers.js";

// The station-pod task endpoints: drift/open-like lookups + queueing a new repo task.

const TaskBody = z.object({
  description: z.string(),
  taskType: z.string(),
  createdBy: z.string().optional(),
  contextBundle: z.record(z.unknown()).optional(),
});

/** What `tasks.create` answers with — the queued task's identity, not its row. */
const StationTaskCreatedSchema = z.object({
  task_id: z.string(),
  task_type: z.string(),
  status: z.string(),
  priority: z.string(),
  created_at: z.string(),
});

/** The task rows a detector compares against — the wire shape, as stored. */
const StationTaskListSchema = z.object({
  tasks: z.array(
    wireSchema(PipelineTaskSchema, PIPELINE_TASK_COLUMNS).partial(),
  ),
});

export function driftTasksRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/tasks/drift",
    options: zodResponse(bearerScope("read"), StationTaskListSchema, {
      name: "DriftTaskList",
      description: "Tasks already open for a spec",
    }),
    handler: async (request, h) => {
      try {
        const q = request.query as Record<string, string | undefined>;

        enforceTrue(
          q.task_type && q.spec_path,
          apiError(400),
          "task_type + spec_path required",
        );
        const p = await projectFor(repoOf(request.params));

        return h.response({
          tasks: await p.tasks.driftTasksForSpec(q.task_type, q.spec_path),
        });
      } catch (err) {
        // A guard's refusal already carries its status; only an unexpected failure is this block's to shape.
        rethrowBoom(err);

        return fail(h, err);
      }
    },
  };
}

export function openLikeTasksRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/tasks/open-like",
    options: zodResponse(bearerScope("read"), StationTaskListSchema, {
      name: "OpenLikeTaskList",
      description: "Open tasks matching a prefix",
    }),
    handler: async (request, h) => {
      try {
        const q = request.query as Record<string, string | undefined>;

        enforceTrue(
          q.task_type && q.description_prefix,
          apiError(400),
          "task_type + description_prefix required",
        );
        const statuses = (q.statuses ?? "").split(",").filter(Boolean);
        const p = await projectFor(repoOf(request.params));

        return h.response({
          tasks: await p.tasks.findOpenLike({
            taskType: q.task_type,
            descriptionPrefix: q.description_prefix,
            statuses,
          }),
        });
      } catch (err) {
        // A guard's refusal already carries its status; only an unexpected failure is this block's to shape.
        rethrowBoom(err);

        return fail(h, err);
      }
    },
  };
}

export function createRepoTaskRoute(): ServerRoute {
  return {
    method: "POST",
    path: "/api/repos/{owner}/{repo}/tasks",
    options: zodResponse(
      {
        ...bearerScope("task"),
        validate: { payload: zodValidate(TaskBody) },
      },
      StationTaskCreatedSchema,
      { name: "StationTaskCreated", description: "The task that was queued" },
    ),
    handler: async (request, h) => {
      try {
        const body = request.payload as z.infer<typeof TaskBody>;
        const p = await projectFor(repoOf(request.params));
        const created = await p.tasks.create({
          description: body.description,
          taskType: body.taskType,
          createdBy: body.createdBy,
          contextBundle: body.contextBundle,
        });

        return h.response(created);
      } catch (err) {
        return fail(h, err);
      }
    },
  };
}
