import { zodResponse } from "../../http/zod-response.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
// Server-side because it needs GitHub App credentials; `lore_get_ci_failures` proxies here so an agent pod can ask what CI said about its own branch without holding a GitHub token.

import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { z } from "zod";
import { projectFor } from "../../../outbound/project-boot.js";
import { readCiFailures, type CiTarget } from "../../../work/ci/ci-failures.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodValidate } from "../../http/zod-validate.js";
import { githubFailureResponse } from "./github-read.js";

const RepoParams = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
});

type RepoParams = z.infer<typeof RepoParams>;

const CiFailuresQuery = z
  .object({
    branch: z.string().min(1).optional(),
    pr_number: z.coerce.number().int().positive().optional(), // eslint-disable-line re-lint/max-member-chain -- pipeline over a value already in hand
  })
  .refine((q) => q.branch !== undefined || q.pr_number !== undefined, {
    message: "branch or pr_number is required",
  });

type CiFailuresQuery = z.infer<typeof CiFailuresQuery>;

// A GitHub read, not a table read, so this shape is stated rather than derived; mirrors `CiFailureReport` in @re-cinq/lore-shared.
const CiFailuresSchema = z.object({
  branch: z.string(),
  judged_sha: z.string().nullable(),
  conclusion: z.enum(["success", "failure", "pending", "none"]),
  failures: z.array(
    z.object({
      name: z.string(),
      app: z.string().nullable(),
      job_id: z.number().nullable(),
      annotations: z.array(z.string()),
      steps: z.array(z.string()),
      tail: z.array(z.string()),
    }),
  ),
});

const ROUTE_OPTIONS = zodResponse(
  {
    ...bearerScope("read"),
    validate: {
      params: zodValidate(RepoParams),
      query: zodValidate(CiFailuresQuery),
    },
  },
  CiFailuresSchema,
  {
    name: "CiFailures",
    description:
      "What CI said about a branch: the judged sha, the verdict, and each failed check with its annotations, failed steps and log tail",
    errors: [400, 404],
  },
);

export function ciFailuresRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/ci-failures",
    options: ROUTE_OPTIONS,
    handler: (request, h) => serveCiFailures(request, h),
  };
}

/** The report for the branch named, or for the pull request's head branch when only its number is known. */
async function serveCiFailures(
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const { owner, repo } = request.params as unknown as RepoParams;
  const query = request.query as unknown as CiFailuresQuery;

  try {
    const project = await projectFor(`${owner}/${repo}`);
    const report = await readCiFailures(project.pulls, targetOf(query));

    enforceTrue(report !== null, apiError(404), "pull request not found");

    return h.response(report);
  } catch (err) {
    return githubFailureResponse(err, h, "branch");
  }
}

/** The branch wins when both are given: it is what the caller is standing on. */
function targetOf(query: CiFailuresQuery): CiTarget {
  return query.branch !== undefined
    ? { branch: query.branch }
    : { prNumber: query.pr_number as number };
}
