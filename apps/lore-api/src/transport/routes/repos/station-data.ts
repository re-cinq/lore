import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { rethrowBoom, apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { z } from "zod";
import { projectFor } from "../../../outbound/project-boot.js";
import { zodResponse } from "../../http/zod-response.js";
import { bearerScope } from "../../http/bearer-scope.js";
import {
  driftTasksRoute,
  openLikeTasksRoute,
  createRepoTaskRoute,
} from "./station-task-routes.js";
import {
  IssueRefSchema,
  createIssueRoute,
  createBranchRoute,
  commitRoute,
  createPullRoute,
} from "./station-write-routes.js";
import { repoOf, fail } from "./station-helpers.js";

export {
  driftTasksRoute,
  openLikeTasksRoute,
  createRepoTaskRoute,
} from "./station-task-routes.js";
export { repoOf, fail } from "./station-helpers.js";

// Data endpoints a station pod (its own image, no Postgres/GitHub App creds — ADR-031 D6/D7) reaches over HTTP via the shared Project facade; declared since an undeclared body is uncheckable across that image boundary.

const OnboardedSchema = z.object({ onboarded: z.boolean() });
const IssueListSchema = z.object({ issues: z.array(IssueRefSchema) });
const LabelListSchema = z.object({ labels: z.array(z.string()) });
const CiConclusionSchema = z.object({
  conclusion: z.enum(["success", "failure", "pending", "none"]),
});

export function stationDataRoutes(): ServerRoute[] {
  return [
    repoOnboardedRoute(),
    listIssuesRoute(),
    listLabelsRoute(),
    createIssueRoute(),
    createBranchRoute(),
    commitRoute(),
    createPullRoute(),
    ciConclusionRoute(),
    driftTasksRoute(),
    openLikeTasksRoute(),
    createRepoTaskRoute(),
  ];
}

function repoOnboardedRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/onboarded",
    options: zodResponse(bearerScope("read"), OnboardedSchema, {
      name: "RepoOnboarded",
      description: "Whether the repo has completed onboarding",
    }),
    handler: async (request, h) => {
      try {
        const p = await projectFor(repoOf(request.params));

        return h.response({ onboarded: await p.settings.isOnboarded() });
      } catch (err) {
        return fail(h, err);
      }
    },
  };
}

function listIssuesRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/issues",
    options: zodResponse(bearerScope("read"), IssueListSchema, {
      name: "RepoIssueList",
      description: "The repo's issues",
    }),
    handler: async (request, h) => {
      try {
        const state =
          (request.query.state as "open" | "closed" | undefined) ?? "open";
        const p = await projectFor(repoOf(request.params));

        return h.response({ issues: await p.issues.list({ state }) });
      } catch (err) {
        return fail(h, err);
      }
    },
  };
}

function listLabelsRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/labels",
    options: zodResponse(bearerScope("read"), LabelListSchema, {
      name: "RepoLabelList",
      description: "The repo's labels",
    }),
    handler: async (request, h) => {
      try {
        const p = await projectFor(repoOf(request.params));

        return h.response({ labels: await p.issues.listLabels() });
      } catch (err) {
        return fail(h, err);
      }
    },
  };
}

/** CI's verdict for one ref. A missing `ref` is the caller's error, so its refusal keeps its own status rather than being flattened into the uniform 500. */
async function serveCiConclusion(
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  try {
    const ref = (request.query.ref as string | undefined) ?? "";

    enforceTrue(ref, apiError(400), "ref required");
    const p = await projectFor(repoOf(request.params));

    return h.response({ conclusion: await p.pulls.ciConclusion(ref) });
  } catch (err) {
    // A guard's refusal already carries its status; only an unexpected failure is this block's to shape.
    rethrowBoom(err);

    return fail(h, err);
  }
}

function ciConclusionRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/ci-conclusion",
    options: zodResponse(bearerScope("read"), CiConclusionSchema, {
      name: "RepoCiConclusion",
      description: "CI's verdict for a ref",
    }),
    handler: (request, h) => serveCiConclusion(request, h),
  };
}
