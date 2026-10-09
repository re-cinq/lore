import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { z } from "zod";
import { projectFor } from "../../../outbound/project-boot.js";
import { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodValidate } from "../../http/zod-validate.js";
import { zodResponse } from "../../http/zod-response.js";
import { githubFailureResponse } from "../repos/github-read.js";

const RepoParams = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
});

const TriageIssueSchema = z.object({
  title: z.string(),
  triage_label: z.string(),
  active_run_link: z.string().optional(),
});

export function triageRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/triage",
    options: zodResponse(
      {
        ...bearerScope("read"),
        validate: { params: zodValidate(RepoParams) },
      },
      z.array(TriageIssueSchema),
      {
        name: "TriageIssues",
        description: "Issues with triage labels and their active floor runs",
        errors: [400, 404],
      },
    ),
    handler: (request, h) => serveTriage(request, h),
  };
}

type FloorRun = { id: string; args?: { issue_number?: number } };
type IssueLike = { title: string; number: number; labels?: string[] };

async function serveTriage(
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const { owner, repo } = request.params as unknown as z.infer<
    typeof RepoParams
  >;
  const fullName = `${owner}/${repo}`;

  try {
    const project = await projectFor(fullName);
    const issues = (await project.issues.list()) as IssueLike[];
    const runs = await fetchRuns(fullName);

    return h.response(buildWireIssues(issues, runs));
  } catch (err) {
    return githubFailureResponse(err, h, "triage issues");
  }
}

async function fetchRuns(repo: string): Promise<FloorRun[]> {
  try {
    const res = await floorClient().runs.list({ repo });

    return res.items as FloorRun[];
  } catch {
    return [];
  }
}

function buildWireIssues(issues: IssueLike[], runs: FloorRun[]) {
  const triageIssues = issues.filter((i) =>
    i.labels?.some((l) => l.startsWith("triage:")),
  );

  return triageIssues.map((issue) => {
    const triageLabel = issue.labels?.find((l) => l.startsWith("triage:"));
    const activeRun = runs.find((r) => r.args?.issue_number === issue.number);

    return {
      title: issue.title,
      triage_label: triageLabel,
      ...(activeRun
        ? { active_run_link: `/api/floor-runs/${activeRun.id}` }
        : {}),
    };
  });
}
