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

async function serveTriage(
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const { owner, repo } = request.params as unknown as typeof RepoParams._type;
  const fullName = `${owner}/${repo}`;

  try {
    const project = await projectFor(fullName);
    const issues = await project.issues.list();

    const triageIssues = issues.filter((i: any) =>
      i.labels?.some((l: string) => l.startsWith("triage:")),
    );

    let runs: any[] = [];
    try {
      runs = await floorClient().listSummaries({ repo: fullName });
    } catch {
      // no floor or unreachable
    }

    const wire = triageIssues.map((issue: any) => {
      const triageLabel = issue.labels.find((l: string) =>
        l.startsWith("triage:"),
      );

      const activeRun = runs.find(
        (r: any) => r.args?.issue_number === issue.number,
      );

      return {
        title: issue.title,
        triage_label: triageLabel,
        ...(activeRun
          ? { active_run_link: `/api/floor-runs/${activeRun.id}` }
          : {}),
      };
    });

    return h.response(wire);
  } catch (err) {
    return githubFailureResponse(err, h, "triage issues");
  }
}
