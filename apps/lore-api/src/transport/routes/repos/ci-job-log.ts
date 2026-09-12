import { zodResponse } from "../../http/zod-response.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
// Server-side because the Actions log read needs GitHub App credentials; `lore_get_ci_job_log` proxies here.

import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { z } from "zod";
import { projectFor } from "../../../outbound/project-boot.js";
import { readCiJobLog } from "../../../work/ci/ci-job-log.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodValidate } from "../../http/zod-validate.js";
import { githubFailureResponse } from "./github-read.js";

const JobParams = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  job_id: z.coerce.number().int().positive(), // eslint-disable-line re-lint/max-member-chain -- pipeline over a value already in hand
});

type JobParams = z.infer<typeof JobParams>;

/** The most lines one read returns: enough for a whole test run's failures, never the install log. */
const MAX_TAIL = 2000;

const JobLogQuery = z.object({
  tail: z.coerce.number().int().min(1).max(MAX_TAIL).default(200), // eslint-disable-line re-lint/max-member-chain -- pipeline over a value already in hand
  grep: z.string().min(1).optional(),
});

type JobLogQuery = z.infer<typeof JobLogQuery>;

const JobLogSchema = z.object({
  job_id: z.number(),
  lines: z.array(z.string()),
  total: z.number(),
  truncated: z.boolean(),
});

const ROUTE_OPTIONS = zodResponse(
  {
    ...bearerScope("read"),
    validate: {
      params: zodValidate(JobParams),
      query: zodValidate(JobLogQuery),
    },
  },
  JobLogSchema,
  {
    name: "CiJobLog",
    description:
      "The tail of one GitHub Actions job's log, timestamps stripped, optionally filtered to lines containing grep",
    errors: [400, 404],
  },
);

export function ciJobLogRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/ci-jobs/{job_id}/log",
    options: ROUTE_OPTIONS,
    handler: (request, h) => serveCiJobLog(request, h),
  };
}

/** One job's log, bounded; a 404 when GitHub will not show it. */
async function serveCiJobLog(
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const { owner, repo, job_id: jobId } = request.params as unknown as JobParams;
  const query = request.query as unknown as JobLogQuery;

  try {
    const project = await projectFor(`${owner}/${repo}`);
    const log = await readCiJobLog(project.pulls, jobId, query);

    enforceTrue(log !== null, apiError(404), "job log not found");

    return h.response(log);
  } catch (err) {
    return githubFailureResponse(err, h, "job");
  }
}
