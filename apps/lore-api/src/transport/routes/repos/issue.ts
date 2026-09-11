// Server-side because the issue read needs GitHub App credentials; the run page shows the issue it works on through here instead of sending the reader to GitHub.

import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { z } from "zod";
import type { IssueRef } from "@re-cinq/lore-shared";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { zodResponse } from "../../http/zod-response.js";
import { projectFor } from "../../../outbound/project-boot.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodValidate } from "../../http/zod-validate.js";
import { RepoNumberParams, githubFailureResponse } from "./github-read.js";

// A GitHub read, not a table read, so this shape is stated rather than derived.
const IssueSchema = z.object({
  number: z.number(),
  title: z.string(),
  state: z.string(),
  url: z.string().nullable(),
  body: z.string().nullable(),
});

export function issueRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/repos/{owner}/{repo}/issues/{number}",
    options: zodResponse(
      {
        ...bearerScope("read"),
        validate: { params: zodValidate(RepoNumberParams) },
      },
      IssueSchema,
      {
        name: "Issue",
        description: "One GitHub issue with its body",
        errors: [400, 404],
      },
    ),
    handler: (request, h) => serveIssue(request, h),
  };
}

/** One issue as the run page shows it; GitHub's null body for an issue opened with no description stays null. */
async function serveIssue(
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const { owner, repo, number } = request.params as unknown as RepoNumberParams;

  try {
    const project = await projectFor(`${owner}/${repo}`);
    const issue = await project.issues.get(number);

    enforceTrue(issue !== null, apiError(404), "issue not found");

    return h.response(toWire(issue));
  } catch (err) {
    return githubFailureResponse(err, h, "issue");
  }
}

function toWire(issue: IssueRef): z.infer<typeof IssueSchema> {
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    url: issue.url ?? null,
    body: issue.body ?? null,
  };
}
