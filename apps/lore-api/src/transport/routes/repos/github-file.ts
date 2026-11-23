import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { z } from "zod";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { actingEnv } from "../../http/acting-env.js";
import { repoLevel } from "../../http/repo-guard.js";
import {
  zodResponse,
  type DeclaredErrorStatus,
} from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import { RepoNumberParams, githubFailureResponse } from "./github-read.js";
import {
  readPullDetails,
  readRepoDetails,
  readRepoFile,
  readRepoReadme,
} from "./github-person-read.js";

const FileQuery = z.object({ path: z.string().min(1) });

const META = {
  name: "GithubFile",
  description: "A file on the default branch, read as the signed-in person",
  errors: [400, 404] as DeclaredErrorStatus[],
};

const FileSchema = z.object({ content: z.string() });

/** FR-141, FR-216: a repository file read on GitHub with the signed-in person's token; needs no onboarded row. */
export function githubFileRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/github/file",
    options: zodResponse(
      {
        ...bearerScope("read"),
        ...repoLevel("read"),
        validate: { query: zodValidate(FileQuery) },
      },
      FileSchema,
      META,
    ),
    handler: (request, h) => serveFile(request, h),
  };
}

async function serveFile(
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const { owner, repo } = request.params as { owner: string; repo: string };
  const { path } = request.query as unknown as z.infer<typeof FileQuery>;

  try {
    const env = (await actingEnv(request)) ?? process.env;
    const content = await readRepoFile(env, `${owner}/${repo}`, path);

    enforceTrue(content !== null, apiError(404), "file not found");

    return h.response({ content });
  } catch (err) {
    return githubFailureResponse(err, h, "file");
  }
}

const ReadmeSchema = z.object({
  markdown: z.string(),
  rawBaseUrl: z.string(),
  htmlUrl: z.string(),
});

const DetailsSchema = z.object({
  description: z.string().nullable(),
  default_branch: z.string(),
  html_url: z.string(),
});

const PullSchema = z.object({
  number: z.number(),
  title: z.string(),
  state: z.string(),
  draft: z.boolean(),
  merged: z.boolean(),
  mergeable: z.boolean().nullable(),
  html_url: z.string(),
  checks: z.array(
    z.object({
      name: z.string(),
      status: z.string(),
      conclusion: z.string().nullable(),
    }),
  ),
  reviews: z.array(
    z.object({
      user: z.string(),
      state: z.string(),
      submitted_at: z.string(),
    }),
  ),
  computed_status: z.string(),
});

interface PersonRead {
  suffix: string;
  resource: string;
  meta: { name: string; description: string };
  schema: z.ZodType;
  read: (env: NodeJS.ProcessEnv, request: Request) => Promise<object>;
}

export function githubReadmeRoute(): ServerRoute {
  return personReadRoute({
    suffix: "readme",
    resource: "readme",
    meta: {
      name: "GithubReadme",
      description: "A repository README, read as the signed-in person",
    },
    schema: ReadmeSchema,
    read: (env, request) => readRepoReadme(env, repoOf(request)),
  });
}

export function githubDetailsRoute(): ServerRoute {
  return personReadRoute({
    suffix: "details",
    resource: "repository",
    meta: {
      name: "GithubRepoDetails",
      description: "A repository's details, read as the signed-in person",
    },
    schema: DetailsSchema,
    read: (env, request) => readRepoDetails(env, repoOf(request)),
  });
}

export function githubPullRoute(): ServerRoute {
  return personReadRoute({
    suffix: "pulls/{number}",
    resource: "pull request",
    meta: {
      name: "GithubPull",
      description: "A pull request's details, read as the signed-in person",
    },
    schema: PullSchema,
    read: (env, request) =>
      readPullDetails(
        env,
        repoOf(request),
        (request.params as unknown as RepoNumberParams).number,
      ),
  });
}

/** A GET route under a repository's `github/` that reads GitHub as the signed-in person and needs no onboarded row. */
function personReadRoute(spec: PersonRead): ServerRoute {
  return {
    method: "GET",
    path: `/api/repos/{owner}/{repo}/github/${spec.suffix}`,
    options: zodResponse(readGuards(spec.suffix), spec.schema, {
      ...spec.meta,
      errors: [404],
    }),
    handler: (request, h) => servePersonRead(spec, request, h),
  };
}

function readGuards(suffix: string) {
  return {
    ...bearerScope("read"),
    ...repoLevel("read"),
    ...(suffix.startsWith("pulls")
      ? { validate: { params: zodValidate(RepoNumberParams) } }
      : {}),
  };
}

async function servePersonRead(
  spec: PersonRead,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  try {
    const env = (await actingEnv(request)) ?? process.env;

    return h.response(await spec.read(env, request));
  } catch (err) {
    return githubFailureResponse(err, h, spec.resource);
  }
}

function repoOf(request: Request): string {
  const { owner, repo } = request.params as { owner: string; repo: string };

  return `${owner}/${repo}`;
}

/** The GitHub-reading routes that name a repository in their path and act as the signed-in person. */
export function githubReadRoutes(): ServerRoute[] {
  return [
    githubFileRoute(),
    githubReadmeRoute(),
    githubDetailsRoute(),
    githubPullRoute(),
  ];
}
