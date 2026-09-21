import { zodResponse } from "../../http/zod-response.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError, rethrowBoom } from "@re-cinq/lore-shared/http/api-error.js";
import { errorMessage } from "@re-cinq/lore-shared";
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
import { githubFailureResponse, httpStatusOf } from "./github-read.js";

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

/** One job's log, bounded; a 404 when GitHub has no such job, and a 424 carrying GitHub's status and message when it refuses the read. 424 because the MCP proxy passes a non-retriable 4xx through with its body: a 5xx is retried and its body dropped, a 403 reads as the caller's own token, and a 404 reads as a job that does not exist. */
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
    return jobLogFailure(err, h);
  }
}

/** A failed log read as an HTTP answer: GitHub's own refusal as a 424, everything else as the shared GitHub response. */
function jobLogFailure(err: unknown, h: ResponseToolkit): ResponseObject {
  rethrowBoom(err);
  // An error carrying no GitHub status (unconfigured, network) is answered by the shared GitHub response, as a 404 is.
  const status = httpStatusOf(err) ?? 404;

  enforceTrue(
    status === 404,
    apiError(424),
    refusalMessage(status, errorMessage(err)),
  );

  return githubFailureResponse(err, h, "job");
}

const ACTIONS_READ_HINT =
  " — a 403 naming the integration means the GitHub App lacks Actions read permission on this repository";

/** GitHub's refusal in its own words, with its status. A 403 is also how GitHub rate-limits, so the permission hint is only a reading of the message, never a replacement for it. */
function refusalMessage(status: number, said: string): string {
  const hint = status === 403 ? ACTIONS_READ_HINT : "";

  return `GitHub would not serve the job log (${status}): ${said}${hint}`;
}
