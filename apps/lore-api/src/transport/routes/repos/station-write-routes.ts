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
import { OkSchema } from "../../http/ok-schema.js";

// The write half of the station-pod surface: a pod holds no GitHub App creds (ADR-031 D6/D7), so every issue/branch/commit/pull write it makes comes back through these routes and the shared Project facade.

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

export const IssueRefSchema = z.object({
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

async function serveCreateIssue(
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  try {
    const { title, body, labels } = request.payload as z.infer<
      typeof IssueBody
    >;
    const p = await projectFor(repoOf(request.params));

    return h.response(await p.issues.create(title, body, labels));
  } catch (err) {
    return fail(h, err);
  }
}

export function createIssueRoute(): ServerRoute {
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
    handler: (request, h) => serveCreateIssue(request, h),
  };
}

async function serveCreateBranch(
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  try {
    const { branch, base } = request.payload as z.infer<typeof BranchBody>;
    const p = await projectFor(repoOf(request.params));

    await p.repo.createBranch(branch, base);

    return h.response({ ok: true });
  } catch (err) {
    return fail(h, err);
  }
}

export function createBranchRoute(): ServerRoute {
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
    handler: (request, h) => serveCreateBranch(request, h),
  };
}

async function serveCommit(
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
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
}

export function commitRoute(): ServerRoute {
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
    handler: (request, h) => serveCommit(request, h),
  };
}

async function serveCreatePull(
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  try {
    const { branch, title, body, base, labels } = request.payload as z.infer<
      typeof PullBody
    >;
    const p = await projectFor(repoOf(request.params));

    return h.response(
      await p.pulls.open(branch, { title, body, base, labels }),
    );
  } catch (err) {
    return fail(h, err);
  }
}

export function createPullRoute(): ServerRoute {
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
    handler: (request, h) => serveCreatePull(request, h),
  };
}
