import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { ServerRoute } from "@hapi/hapi";
import { rethrowBoom, apiError } from "../../../server/api-error.js";
import { z } from "zod";
import { projectFor } from "../../../platform/project-boot.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import {
  driftTasksRoute,
  openLikeTasksRoute,
  createRepoTaskRoute,
} from "./station-task-routes.js";
import { repoOf, fail } from "./station-helpers.js";

export {
  driftTasksRoute,
  openLikeTasksRoute,
  createRepoTaskRoute,
} from "./station-task-routes.js";
export { repoOf, fail } from "./station-helpers.js";

const IssueBody = z.object({
  title: z.string(),
  body: z.string(),
  labels: z.array(z.string()).optional(),
});
const BranchBody = z.object({
  branch: z.string(),
  base: z.string().optional(),
});
const CommitBody = z.object({
  branch: z.string(),
  path: z.string(),
  content: z.string(),
  message: z.string(),
});
const PullBody = z.object({
  branch: z.string(),
  title: z.string(),
  body: z.string(),
  base: z.string().optional(),
  labels: z.array(z.string()).optional(),
});
// Data + write endpoints + bodies a station pod (its own image, no Postgres/GitHub App creds — ADR-031 D6/D7) reaches over HTTP via the shared Project facade; declared since an undeclared body is uncheckable across that image boundary.
const IssueRefSchema = z.object({
  repo: z.string(),
  number: z.number(),
  title: z.string(),
  state: z.enum(["open", "closed"]),
  labels: z.array(z.string()),
  url: z.string().optional(),
});

const PullRefSchema = z.object({
  repo: z.string(),
  number: z.number(),
  title: z.string(),
  branch: z.string(),
  state: z.enum(["open", "closed", "merged"]),
  labels: z.array(z.string()),
  url: z.string(),
  author: z.string().optional(),
  draft: z.boolean().optional(),
});

const OnboardedSchema = z.object({ onboarded: z.boolean() });
const IssueListSchema = z.object({ issues: z.array(IssueRefSchema) });
const LabelListSchema = z.object({ labels: z.array(z.string()) });
const OkSchema = z.object({ ok: z.literal(true) });
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

function createIssueRoute(): ServerRoute {
  return {
    method: "POST",
    path: "/api/repos/{owner}/{repo}/issues",
    options: zodResponse(
      {
        ...bearerScope("write"),
        validate: { payload: zodValidate(IssueBody) },
      },
      IssueRefSchema,
      { name: "RepoIssueCreated", description: "The issue that was opened" },
    ),
    handler: async (request, h) => {
      try {
        const { title, body, labels } = request.payload as z.infer<
          typeof IssueBody
        >;
        const p = await projectFor(repoOf(request.params));

        return h.response(await p.issues.create(title, body, labels));
      } catch (err) {
        return fail(h, err);
      }
    },
  };
}

function createBranchRoute(): ServerRoute {
  return {
    method: "POST",
    path: "/api/repos/{owner}/{repo}/branches",
    options: zodResponse(
      {
        ...bearerScope("write"),
        validate: { payload: zodValidate(BranchBody) },
      },
      OkSchema,
      { name: "BranchCreated", description: "The branch was created" },
    ),
    handler: async (request, h) => {
      try {
        const { branch, base } = request.payload as z.infer<typeof BranchBody>;
        const p = await projectFor(repoOf(request.params));

        await p.repo.createBranch(branch, base);

        return h.response({ ok: true });
      } catch (err) {
        return fail(h, err);
      }
    },
  };
}

function commitRoute(): ServerRoute {
  return {
    method: "POST",
    path: "/api/repos/{owner}/{repo}/commit",
    options: zodResponse(
      {
        ...bearerScope("write"),
        validate: { payload: zodValidate(CommitBody) },
      },
      OkSchema,
      { name: "CommitCreated", description: "The commit was pushed" },
    ),
    handler: async (request, h) => {
      try {
        const { branch, path, content, message } = request.payload as z.infer<
          typeof CommitBody
        >;
        const p = await projectFor(repoOf(request.params));

        await p.repo.commitFile(branch, path, content, message);

        return h.response({ ok: true });
      } catch (err) {
        return fail(h, err);
      }
    },
  };
}

function createPullRoute(): ServerRoute {
  return {
    method: "POST",
    path: "/api/repos/{owner}/{repo}/pulls",
    options: zodResponse(
      {
        ...bearerScope("write"),
        validate: { payload: zodValidate(PullBody) },
      },
      PullRefSchema,
      { name: "PullOpened", description: "The pull request that was opened" },
    ),
    handler: async (request, h) => {
      try {
        const { branch, title, body, base, labels } =
          request.payload as z.infer<typeof PullBody>;
        const p = await projectFor(repoOf(request.params));

        return h.response(
          await p.pulls.open(branch, { title, body, base, labels }),
        );
      } catch (err) {
        return fail(h, err);
      }
    },
  };
}

function ciConclusionRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/ci-conclusion",
    options: zodResponse(bearerScope("read"), CiConclusionSchema, {
      name: "RepoCiConclusion",
      description: "CI's verdict for a ref",
    }),
    handler: async (request, h) => {
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
    },
  };
}
