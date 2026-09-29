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
import { OkSchema } from "../../http/ok-schema.js";
import { RepoNumberParams } from "./github-read.js";
import { repoOf, fail } from "./station-helpers.js";

// How the issues station ties a plan's task issues to its story issue: the station holds no GitHub App creds (ADR-031 D6/D7), so both writes come back through here.

const SubIssueBody = z.object({ child: z.number().int().positive() });
const IssueBodyUpdate = z.object({ body: z.string() });

export function addSubIssueRoute(): ServerRoute {
  return {
    method: "POST",
    path: "/api/repos/{owner}/{repo}/issues/{number}/sub-issues",
    options: issueWriteOptions(SubIssueBody, {
      name: "SubIssueAdded",
      description: "The child issue is now a sub-issue of this one",
    }),
    handler: (request, h) => serveAddSubIssue(request, h),
  };
}

// Both writes: write scope, the repo + issue number in the path, a JSON body, `{ ok: true }` back.
function issueWriteOptions(
  payload: z.ZodType,
  doc: { name: string; description: string },
) {
  return zodResponse(
    {
      ...bearerScope("write"),
      validate: {
        params: zodValidate(RepoNumberParams),
        payload: zodValidate(payload),
      },
    },
    OkSchema,
    doc,
  );
}

async function serveAddSubIssue(
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  try {
    const { number } = request.params as unknown as RepoNumberParams;
    const { child } = request.payload as z.infer<typeof SubIssueBody>;
    const p = await projectFor(repoOf(request.params));

    await p.issues.addSubIssue(number, child);

    return h.response({ ok: true });
  } catch (err) {
    return fail(h, err);
  }
}

export function updateIssueBodyRoute(): ServerRoute {
  return {
    method: "PATCH",
    path: "/api/repos/{owner}/{repo}/issues/{number}",
    options: issueWriteOptions(IssueBodyUpdate, {
      name: "IssueBodyUpdated",
      description: "The issue's body was rewritten",
    }),
    handler: (request, h) => serveUpdateIssueBody(request, h),
  };
}

async function serveUpdateIssueBody(
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  try {
    const { number } = request.params as unknown as RepoNumberParams;
    const { body } = request.payload as z.infer<typeof IssueBodyUpdate>;
    const p = await projectFor(repoOf(request.params));

    await p.issues.updateBody(number, body);

    return h.response({ ok: true });
  } catch (err) {
    return fail(h, err);
  }
}
