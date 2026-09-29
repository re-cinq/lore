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

// How the issues station files a plan's spec-tasks: the whole set in one call, reconciled against what the plan already has, so a rerun reuses and cancels rather than adds (the station holds no database, D7).

const SpecTaskBody = z.object({
  description: z.string(),
  taskType: z.string(),
  createdBy: z.string().optional(),
  contextBundle: z.record(z.string(), z.unknown()).optional(),
  taskGroupId: z.string().optional(),
  issueNumber: z.number().int().positive(),
  issueUrl: z.string().optional(),
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
