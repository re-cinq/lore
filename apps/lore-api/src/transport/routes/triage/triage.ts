import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { z } from "zod";
import { floorConfigured } from "@re-cinq/lore-shared/floor/floor-client.js";
import { floorRunReader } from "../../../work/floor/floor-backed-runs.js";
import { isOpenStatus } from "../../../work/floor/floor-run-query.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodValidate } from "../../http/zod-validate.js";
import { zodResponse } from "../../http/zod-response.js";
import {
  githubFailureResponse,
  onboardedProject,
} from "../repos/github-read.js";
import {
  IssueTriageSchema,
  triageBuckets,
  type TriageIssue,
  type TriageRun,
} from "./triage-buckets.js";

const RepoParams = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
});

/** The repo's open issue-triage runs, each with the issue it was started for and its stages. */
export type OpenTriageRuns = (repo: string) => Promise<TriageRun[]>;

const TRIAGE_LINE = "issue-triage";

/** How many of the line's newest runs are read for the open ones: the sweep runs three at a time per repo. */
const RUNS_READ = 50;

/** Read through the reader the run list uses, so each run carries its mini pipeline; a floor that cannot answer leaves every row without a run rather than failing the list. */
export const openTriageRuns: OpenTriageRuns = async (repo) => {
  if (!floorConfigured()) {
    return [];
  }

  const reader = floorRunReader();
  const { runs } = await reader
    .page({ repo, line: TRIAGE_LINE, limit: RUNS_READ })
    .catch(() => ({ runs: [] }));

  return runs
    .filter(({ run }) => isOpenStatus(run.status))
    .map(({ run, pipeline }) => ({
      id: run.id,
      issueNumber: issueNumberOf(run.args),
      pipeline,
    }));
};

function issueNumberOf(args: Record<string, unknown>): string | undefined {
  const value = args.issue_number;

  return value === undefined ? undefined : String(value);
}

const TRIAGE_OPTIONS = zodResponse(
  {
    ...bearerScope("read"),
    validate: { params: zodValidate(RepoParams) },
  },
  IssueTriageSchema,
  {
    name: "IssueTriage",
    description:
      "Issue triage in the shared loop sections: issues a run is working, waiting, parked on a person, and done",
    errors: [400, 404],
  },
);

export function triageRoute(
  runsOf: OpenTriageRuns = openTriageRuns,
): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/triage",
    options: TRIAGE_OPTIONS,
    handler: (request, h) => serveTriage(runsOf, request, h),
  };
}

async function serveTriage(
  runsOf: OpenTriageRuns,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const { owner, repo } = request.params as z.infer<typeof RepoParams>;
  const fullName = `${owner}/${repo}`;

  try {
    const project = await onboardedProject(fullName);
    const [issues, runs] = await Promise.all([
      project.issues.list({ state: "open" }) as Promise<TriageIssue[]>,
      runsOf(fullName),
    ]);

    return h.response(triageBuckets(issues, runs));
  } catch (err) {
    return githubFailureResponse(err, h, "triage issues");
  }
}
