import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { z } from "zod";
import { projectFor } from "../../../outbound/project-boot.js";
import { zodResponse } from "../../http/zod-response.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodValidate } from "../../http/zod-validate.js";
import { repoOf, fail } from "./station-helpers.js";
import { TaskBody } from "./station-task-routes.js";

// How the issues station files a plan's spec-tasks: the whole set in one call, reconciled against what the plan already has, so a rerun reuses and cancels rather than adds (the station holds no database, D7).

// A spec-task is always filed on its task issue, so the number the plain task body leaves optional is required here.
const SpecTaskBody = TaskBody.extend({
  issueNumber: z.number().int().positive(),
});

const ReconcileBody = z.object({
  planId: z.string().optional(),
  groupId: z.string().optional(),
  tasks: z.array(SpecTaskBody),
});

const ReconciledSchema = z.object({
  created: z.number(),
  updated: z.number(),
  cancelled: z.number(),
});

export function reconcileSpecTasksRoute(): ServerRoute {
  return {
    method: "PUT",
    path: "/api/repos/{owner}/{repo}/tasks/spec-tasks",
    options: zodResponse(
      {
        ...bearerScope("task"),
        validate: { payload: zodValidate(ReconcileBody) },
      },
      ReconciledSchema,
      {
        name: "SpecTasksReconciled",
        description: "How many spec-tasks were created, reused and cancelled",
      },
    ),
    handler: (request, h) => serveReconcileSpecTasks(request, h),
  };
}

async function serveReconcileSpecTasks(
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  try {
    const p = await projectFor(repoOf(request.params));
    const reconciled = await p.tasks.reconcileSpecTasks(
      request.payload as z.infer<typeof ReconcileBody>,
    );

    return h.response(reconciled);
  } catch (err) {
    return fail(h, err);
  }
}
