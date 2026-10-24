import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { z } from "zod";
import type { IssueRef, Project } from "@re-cinq/lore-shared";
import { floorConfigured } from "@re-cinq/lore-shared/floor/floor-client.js";
import { floorRunReader } from "../../../work/floor/floor-backed-runs.js";
import { isOpenStatus } from "../../../work/floor/floor-run-query.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodValidate } from "../../http/zod-validate.js";
import {
  capSections,
  SectionLimitsQuery,
  type SectionLimits,
} from "../loops/loop-sections.js";
import { zodResponse } from "../../http/zod-response.js";
import {
  githubFailureResponse,
  onboardedProject,
} from "../repos/github-read.js";
import {
  IssueTriageSchema,
  TRIAGE_PRECEDENCE,
  TRIAGE_PREFIX,
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
    validate: {
      params: zodValidate(RepoParams),
      query: zodValidate(SectionLimitsQuery),
    },
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
    const { issues, runs } = await readTriage(fullName, runsOf);

    return h.response(
      capSections(
        triageBuckets(issues as TriageIssue[], runs),
        request.query as SectionLimits,
      ),
    );
  } catch (err) {
    return githubFailureResponse(err, h, "triage issues");
  }
}

/** Triage's issues and its open runs, read together. */
async function readTriage(fullName: string, runsOf: OpenTriageRuns) {
  const project = await onboardedProject(fullName);
  const [labelled, runs] = await Promise.all([
    triageLabelled(project.issues),
    runsOf(fullName),
  ]);

  return { issues: await withRunIssues(project.issues, labelled, runs), runs };
}

/** Every `triage:` label the board reads a state from: a child issue triage filed carries `triage: needs-priority` alone (specs/issue-triage FR33), so no one label covers them all. */
const TRIAGE_LABELS = TRIAGE_PRECEDENCE.map(
  (state) => `${TRIAGE_PREFIX}${state}`,
);

/** The open issues carrying any `triage:` label, one GitHub list per label read together and joined, an issue with several once: triage's issues and not every open one (re-cinq/lore has 555). */
async function triageLabelled(
  issues: Pick<Project["issues"], "list">,
): Promise<IssueRef[]> {
  const lists = await Promise.all(
    TRIAGE_LABELS.map((label) =>
      issues.list({ state: "open", labels: [label] }),
    ),
  );

  return [
    ...new Map(lists.flat().map((issue) => [issue.number, issue])).values(),
  ];
}

/** The issues a triage run took up before any label landed: not in the labelled list, read one by one, a handful at most. */
async function withRunIssues(
  issues: Pick<Project["issues"], "get">,
  labelled: readonly IssueRef[],
  runs: readonly { issueNumber: string | undefined }[],
): Promise<IssueRef[]> {
  const listed = new Set(labelled.map((issue) => String(issue.number)));
  const unlisted = runs
    .map((run) => run.issueNumber)
    .filter((n): n is string => n !== undefined && !listed.has(n));
  const read = await Promise.all(unlisted.map((n) => issues.get(Number(n))));

  return [
    ...labelled,
    ...read.filter((issue) => issue?.state === "open"),
  ].filter((issue): issue is IssueRef => issue !== null);
}
